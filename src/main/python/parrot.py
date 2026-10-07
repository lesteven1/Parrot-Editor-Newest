"""Bundled Parrot runtime for readable Scratch-derived Python programs."""

import base64
import io
import json
import math
import os
import random
import struct
import sys
import threading
import time
from pathlib import Path

os.environ.setdefault("PYGAME_HIDE_SUPPORT_PROMPT", "1")
import pygame

WIDTH, HEIGHT = 480, 360
FPS = 60
FRAME_SECONDS = 1 / FPS
FRAME_PREFIX = "__PARROT_FRAME__:"


def scratch_number(value):
    if isinstance(value, bool):
        return 1 if value else 0
    try:
        number = float(str(value).strip())
        return int(number) if number.is_integer() else number
    except (TypeError, ValueError):
        return 0


def scratch_truth(value):
    if isinstance(value, str):
        return value.strip().lower() not in ("", "0", "false")
    return bool(value)


def scratch_compare(left, right):
    try:
        left_number = float(str(left).strip())
        right_number = float(str(right).strip())
        return (left_number > right_number) - (left_number < right_number)
    except (TypeError, ValueError):
        left_text, right_text = str(left).lower(), str(right).lower()
        return (left_text > right_text) - (left_text < right_text)


def scratch_equals(left, right):
    return scratch_compare(left, right) == 0


def scratch_divide(left, right):
    numerator, denominator = scratch_number(left), scratch_number(right)
    if denominator == 0:
        return math.inf if numerator >= 0 else -math.inf
    return numerator / denominator


def _finite_number(value, fallback=0):
    number = scratch_number(value)
    return number if math.isfinite(number) else fallback


def _scratch_direction(value):
    number = scratch_number(value)
    if not math.isfinite(number):
        return None
    return number - math.floor((number + 179) / 360) * 360


def _scratch_round(value):
    return math.floor(value + 0.5)


def _float32(value):
    return struct.unpack("f", struct.pack("f", value))[0]


def _fallback_image(error=False):
    surface = pygame.Surface((48, 48), pygame.SRCALPHA)
    if error:
        pygame.draw.rect(surface, "#ff7a59", (2, 2, 44, 44), border_radius=8)
    else:
        pygame.draw.circle(surface, "#8b7cf6", (24, 24), 21)
    return surface


def _load_image(asset, asset_directory):
    if not asset:
        return _fallback_image()
    try:
        filename = str(asset.get("file", ""))
        if not filename or Path(filename).name != filename:
            raise ValueError("Invalid asset name")
        return pygame.image.load(asset_directory / filename, asset.get("sourceName", filename)).convert_alpha()
    except Exception:
        return _fallback_image(error=True)


class Variable:
    def __init__(self, definition):
        self.definition = definition
        self.id = str(definition.get("id", ""))
        self.name = str(definition.get("name", self.id))
        self.owner = str(definition.get("owner", ""))
        self.value = definition.get("value", 0)

    def reset(self):
        self.value = self.definition.get("value", 0)

    def set(self, value):
        self.value = value

    def change(self, amount):
        self.value = scratch_number(self.value) + scratch_number(amount)


class Sprite:
    def __init__(self, project, definition, asset_directory):
        self.project = project
        self.definition = definition
        self.name = definition["name"]
        self.original_image = _load_image(definition.get("asset"), asset_directory)
        self.reset()

    def reset(self):
        self.x = _finite_number(self.definition.get("x", 0))
        self.y = _finite_number(self.definition.get("y", 0))
        self.direction = _scratch_direction(self.definition.get("direction", 90)) or 0
        self.rotation_style = str(self.definition.get("rotationStyle", "all around"))
        if self.rotation_style not in ("all around", "left-right", "don't rotate"):
            self.rotation_style = "all around"
        self.visible = self.definition.get("visible", True)
        self._costume_resolution = max(1, _finite_number(self.definition.get("bitmapResolution", 1), 1))
        self._skin_size = (
            self.original_image.get_width() / self._costume_resolution,
            self.original_image.get_height() / self._costume_resolution,
        )
        self._skin_anchor = (
            float(self.definition.get("rotationCenterX", self.original_image.get_width() / 2)) /
            self._costume_resolution,
            float(self.definition.get("rotationCenterY", self.original_image.get_height() / 2)) /
            self._costume_resolution,
        )
        self._hull_points = self._scratch_hull_points()
        self._rebuild_scaled_costume()
        self._refresh_transform()

    def _rebuild_scaled_costume(self):
        scale = max(0.01, self.definition.get("size", 100) / 100)
        width = max(1, round(self._skin_size[0] * scale))
        height = max(1, round(self._skin_size[1] * scale))
        self._scaled_image = pygame.transform.smoothscale(self.original_image, (width, height))
        self._scaled_anchor = (
            self._skin_anchor[0] * scale,
            self._skin_anchor[1] * scale,
        )

    def set_motion_geometry(self, definition):
        if not isinstance(definition, dict):
            return
        skin_size = definition.get("skinSize")
        rotation_center = definition.get("rotationCenter")
        hull_points = definition.get("hullPoints")
        if (
            not isinstance(skin_size, list) or len(skin_size) != 2 or
            not isinstance(rotation_center, list) or len(rotation_center) != 2 or
            not isinstance(hull_points, list) or len(hull_points) > 8192
        ):
            return

        def valid_pair(pair, positive=False):
            return (
                isinstance(pair, list) and len(pair) == 2 and
                all(
                    isinstance(value, (int, float)) and not isinstance(value, bool) and
                    math.isfinite(value) and abs(value) <= 1_000_000 and
                    (not positive or value > 0)
                    for value in pair
                )
            )

        if not valid_pair(skin_size, positive=True) or not valid_pair(rotation_center):
            return
        if not all(valid_pair(point) for point in hull_points):
            return
        self._skin_size = (float(skin_size[0]), float(skin_size[1]))
        self._skin_anchor = (float(rotation_center[0]), float(rotation_center[1]))
        self._hull_points = [(float(point[0]), float(point[1])) for point in hull_points]
        self._rebuild_scaled_costume()
        self._refresh_transform()

    @property
    def x_position(self):
        rounded = round(self.x)
        return rounded if abs(self.x - rounded) < 1e-9 else self.x

    @property
    def y_position(self):
        rounded = round(self.y)
        return rounded if abs(self.y - rounded) < 1e-9 else self.y

    def _refresh_transform(self):
        image = self._scaled_image
        anchor_x, anchor_y = self._scaled_anchor
        if self.rotation_style == "left-right" and self.direction < 0:
            image = pygame.transform.flip(image, True, False)
            anchor_x = image.get_width() - anchor_x
        elif self.rotation_style == "all around":
            angle = 90 - self.direction
            source_width, source_height = image.get_size()
            dx = anchor_x - source_width / 2
            dy = anchor_y - source_height / 2
            radians = math.radians(angle)
            image = pygame.transform.rotate(image, angle)
            anchor_x = image.get_width() / 2 + math.cos(radians) * dx + math.sin(radians) * dy
            anchor_y = image.get_height() / 2 - math.sin(radians) * dx + math.cos(radians) * dy
        self.image = image
        self._render_anchor = (anchor_x, anchor_y)
        self.mask = pygame.mask.from_surface(image)
        opaque_rects = self.mask.get_bounding_rects()
        self._opaque_rect = opaque_rects[0].unionall(opaque_rects[1:]) if opaque_rects else None

    def _scratch_hull_points(self):
        """Match Scratch Render's row-wise linear-sampled costume hull inputs."""
        texture_width, texture_height = self.original_image.get_size()
        skin_width, skin_height = self._skin_size
        if texture_width <= 0 or texture_height <= 0 or skin_width <= 0 or skin_height <= 0:
            return []

        def touches_linear(x, y):
            texture_x = math.floor((x / skin_width) * (texture_width - 1))
            texture_y = math.floor((y / skin_height) * (texture_height - 1))
            for sample_x, sample_y in (
                (texture_x, texture_y), (texture_x + 1, texture_y),
                (texture_x, texture_y + 1), (texture_x + 1, texture_y + 1),
            ):
                if (
                    0 <= sample_x < texture_width and 0 <= sample_y < texture_height and
                    self.original_image.get_at((sample_x, sample_y)).a > 0
                ):
                    return True
            return False

        points = []
        for y in range(math.ceil(skin_height)):
            left = None
            for x in range(math.ceil(skin_width)):
                if touches_linear(x, y):
                    left = x
                    break
            if left is None:
                continue
            right = left
            for x in range(math.ceil(skin_width) - 1, left - 1, -1):
                if touches_linear(x, y):
                    right = x
                    break
            points.append((left, y))
            points.append((right, y))
        return points

    def _scratch_transform(self):
        # Scratch keeps logical positions as doubles but RenderWebGL rounds its
        # drawable position and stores transform math in Float32Array values.
        x = _scratch_round(self.x)
        y = _scratch_round(self.y)
        scale = max(0.01, self.definition.get("size", 100) / 100)
        rendered_direction = self.direction
        scale_x = scale
        scale_y = scale
        if self.rotation_style == "don't rotate":
            rendered_direction = 90
        elif self.rotation_style == "left-right":
            rendered_direction = 90
            scale_x *= -1 if self.direction < 0 else 1

        skin_width, skin_height = self._skin_size
        anchor_x, anchor_y = self._skin_anchor
        radians = math.radians(270 - rendered_direction)
        cosine = _float32(math.cos(radians))
        sine = _float32(math.sin(radians))
        skin_scale_x = _float32(skin_width * scale_x)
        skin_scale_y = _float32(skin_height * scale_y)
        adjusted_x = _float32((anchor_x - skin_width / 2) * scale_x)
        adjusted_y = _float32(-(anchor_y - skin_height / 2) * scale_y)
        return {
            "m0": _float32(skin_scale_x * cosine),
            "m1": _float32(skin_scale_x * sine),
            "m4": _float32(skin_scale_y * -sine),
            "m5": _float32(skin_scale_y * cosine),
            "m12": _float32(cosine * adjusted_x + (-sine) * adjusted_y + x),
            "m13": _float32(sine * adjusted_x + cosine * adjusted_y + y),
        }

    def _fence_bounds(self):
        transform = self._scratch_transform()
        extent_x = abs(0.5 * transform["m0"]) + abs(0.5 * transform["m4"])
        extent_y = abs(0.5 * transform["m1"]) + abs(0.5 * transform["m5"])
        return {
            "left": transform["m12"] - extent_x,
            "right": transform["m12"] + extent_x,
            "top": transform["m13"] + extent_y,
            "bottom": transform["m13"] - extent_y,
        }

    def _precise_bounds(self, x=None, y=None):
        if not self._hull_points:
            return self._fence_bounds()
        transform = self._scratch_transform()
        skin_width, skin_height = self._skin_size
        transformed = []
        for point_x, point_y in self._hull_points:
            local_x = _float32(0.5 - (point_x / skin_width) - (0.5 / skin_width))
            local_y = _float32((point_y / skin_height) - 0.5 + (0.5 / skin_height))
            transformed.append((
                _float32(transform["m0"] * local_x + transform["m4"] * local_y + transform["m12"]),
                _float32(transform["m1"] * local_x + transform["m5"] * local_y + transform["m13"]),
            ))
        xs = [point[0] for point in transformed]
        ys = [point[1] for point in transformed]
        bounds = {"left": min(xs), "right": max(xs), "top": max(ys), "bottom": min(ys)}
        if x is not None:
            dx = x - self.x
            bounds["left"] += dx
            bounds["right"] += dx
        if y is not None:
            dy = y - self.y
            bounds["top"] += dy
            bounds["bottom"] += dy
        return bounds

    def _fenced_position(self, x, y):
        bounds = self._fence_bounds()
        if not bounds:
            return x, y
        inset = math.floor(min(bounds["right"] - bounds["left"], bounds["top"] - bounds["bottom"]) / 2)
        sx = WIDTH / 2 - min(15, inset)
        sy = HEIGHT / 2 - min(15, inset)
        render_x = _scratch_round(self.x)
        render_y = _scratch_round(self.y)
        dx = x - render_x
        dy = y - render_y
        if bounds["right"] + dx < -sx:
            x = math.ceil(render_x - (sx + bounds["right"]))
        elif bounds["left"] + dx > sx:
            x = math.floor(render_x + (sx - bounds["left"]))
        if bounds["top"] + dy < -sy:
            y = math.ceil(render_y - (sy + bounds["top"]))
        elif bounds["bottom"] + dy > sy:
            y = math.floor(render_y + (sy - bounds["bottom"]))
        return x, y

    def _keep_in_stage(self, x, y):
        bounds = self._precise_bounds(x, y)
        if not bounds:
            return x, y
        dx = 0
        dy = 0
        if bounds["left"] < -WIDTH / 2:
            dx += -WIDTH / 2 - bounds["left"]
        if bounds["right"] > WIDTH / 2:
            dx += WIDTH / 2 - bounds["right"]
        if bounds["top"] > HEIGHT / 2:
            dy += HEIGHT / 2 - bounds["top"]
        if bounds["bottom"] < -HEIGHT / 2:
            dy += -HEIGHT / 2 - bounds["bottom"]
        return x + dx, y + dy

    def _set_xy(self, x, y, fence=True):
        x, y = _finite_number(x), _finite_number(y)
        if fence:
            x, y = self._fenced_position(x, y)
        self.x, self.y = x, y

    def go_to(self, x, y):
        self._set_xy(x, y)

    def _target_position(self, target_name):
        target_name = str(target_name)
        if target_name == "_mouse_":
            return self.project.mouse_position()
        if target_name == "_random_":
            return (
                _scratch_round(WIDTH * (random.random() - 0.5)),
                _scratch_round(HEIGHT * (random.random() - 0.5)),
            )
        target = self.project._sprites.get(target_name)
        return (target.x, target.y) if target else None

    def go_to_target(self, target_name):
        destination = self._target_position(target_name)
        if destination:
            self._set_xy(*destination)

    async def glide_to(self, x, y, seconds):
        end_x, end_y = _finite_number(x), _finite_number(y)
        duration = scratch_number(seconds)
        if duration <= 0:
            self._set_xy(end_x, end_y)
            return
        start_x, start_y = self.x, self.y
        if self.project._follow_scratch_clock:
            start_time_ms = self.project._logical_time_ms
            duration_ms = duration * 1000
            elapsed_ms = 0
            while elapsed_ms < duration_ms:
                await self.project.next_frame()
                elapsed_ms = self.project._logical_time_ms - start_time_ms
                fraction = min(1.0, elapsed_ms / duration_ms)
                self._set_xy(
                    start_x + fraction * (end_x - start_x),
                    start_y + fraction * (end_y - start_y),
                )
            self._set_xy(end_x, end_y)
            return
        elapsed_frames = 0
        while elapsed_frames * FRAME_SECONDS < duration:
            await self.project.next_frame()
            elapsed_frames += 1
            elapsed = elapsed_frames * FRAME_SECONDS
            fraction = min(1.0, elapsed / duration)
            self._set_xy(
                start_x + fraction * (end_x - start_x),
                start_y + fraction * (end_y - start_y),
            )
        self._set_xy(end_x, end_y)

    async def glide_to_target(self, target_name, seconds):
        destination = self._target_position(target_name)
        if destination:
            await self.glide_to(destination[0], destination[1], seconds)

    def set_direction(self, value):
        direction = _scratch_direction(value)
        if direction is None:
            return
        self.direction = direction
        self._refresh_transform()

    def move(self, steps):
        radians = math.radians(90 - self.direction)
        distance = scratch_number(steps)
        self._set_xy(self.x + distance * math.cos(radians), self.y + distance * math.sin(radians))

    def turn_right(self, degrees):
        self.set_direction(self.direction + scratch_number(degrees))

    def turn_left(self, degrees):
        self.set_direction(self.direction - scratch_number(degrees))

    def point_in_direction(self, direction):
        self.set_direction(direction)

    def point_towards(self, target_name):
        if str(target_name) == "_random_":
            self.set_direction(_scratch_round(random.random() * 360) - 180)
            return
        destination = self._target_position(target_name)
        if not destination:
            return
        dx, dy = destination[0] - self.x, destination[1] - self.y
        self.set_direction(90 - math.degrees(math.atan2(dy, dx)))

    def set_x(self, value):
        self._set_xy(value, self.y)

    def set_y(self, value):
        self._set_xy(self.x, value)

    def change_x(self, amount):
        self._set_xy(self.x + scratch_number(amount), self.y)

    def change_y(self, amount):
        self._set_xy(self.x, self.y + scratch_number(amount))

    def set_rotation_style(self, style):
        style = str(style)
        if style in ("all around", "left-right", "don't rotate"):
            self.rotation_style = style
            self._refresh_transform()

    def bounce_if_on_edge(self):
        bounds = self._precise_bounds()
        if not bounds:
            return
        distances = {
            "left": max(0, WIDTH / 2 + bounds["left"]),
            "top": max(0, HEIGHT / 2 - bounds["top"]),
            "right": max(0, WIDTH / 2 - bounds["right"]),
            "bottom": max(0, HEIGHT / 2 + bounds["bottom"]),
        }
        nearest_edge = min(distances, key=distances.get)
        if distances[nearest_edge] > 0:
            return
        radians = math.radians(90 - self.direction)
        dx = math.cos(radians)
        dy = -math.sin(radians)
        if nearest_edge == "left":
            dx = max(0.2, abs(dx))
        elif nearest_edge == "top":
            dy = max(0.2, abs(dy))
        elif nearest_edge == "right":
            dx = -max(0.2, abs(dx))
        else:
            dy = -max(0.2, abs(dy))
        self.set_direction(math.degrees(math.atan2(dy, dx)) + 90)
        self.x, self.y = self._keep_in_stage(self.x, self.y)

    def show(self):
        self.visible = True

    def hide(self):
        self.visible = False

    def rect(self):
        anchor_x, anchor_y = self._render_anchor
        return pygame.Rect(
            round(WIDTH / 2 + self.x - anchor_x),
            round(HEIGHT / 2 - self.y - anchor_y),
            self.image.get_width(),
            self.image.get_height(),
        )

    def touching(self, target_name):
        target_name = str(target_name)
        own_rect = self.rect()
        if target_name in ("_edge_", "edge"):
            bounds = self._precise_bounds()
            return bool(bounds and (
                bounds["left"] < -WIDTH / 2 or bounds["right"] > WIDTH / 2 or
                bounds["top"] > HEIGHT / 2 or bounds["bottom"] < -HEIGHT / 2
            ))
        other = self.project._sprites.get(target_name)
        if not other or not self.visible or not other.visible:
            return False
        other_rect = other.rect()
        offset = (other_rect.left - own_rect.left, other_rect.top - own_rect.top)
        return self.mask.overlap(other.mask, offset) is not None

    def draw(self, screen):
        if self.visible:
            screen.blit(self.image, self.rect())


class Stage:
    x = 0
    y = 0
    visible = True

    def go_to(self, _x, _y):
        pass

    def set_x(self, _value):
        pass

    def set_y(self, _value):
        pass

    def change_x(self, _amount):
        pass

    def change_y(self, _amount):
        pass

    def show(self):
        self.visible = True

    def hide(self):
        self.visible = False

    def touching(self, _target_name):
        return False


class _NextFrame:
    def __await__(self):
        yield None


def _normalize_key(name):
    return (str(name).strip().lower()
            .replace("arrowright", "right arrow")
            .replace("arrowleft", "left arrow")
            .replace("arrowup", "up arrow")
            .replace("arrowdown", "down arrow"))


class Project:
    def __init__(self):
        manifest_path = Path(os.environ.get("PARROT_PROJECT_MANIFEST", "project.json")).resolve()
        with manifest_path.open("r", encoding="utf-8") as manifest_file:
            self._manifest = json.load(manifest_file)
        if self._manifest.get("version") != 1:
            raise RuntimeError("This project needs a different Parrot runtime version.")

        pygame.init()
        self._screen = pygame.display.set_mode((WIDTH, HEIGHT))
        pygame.display.set_caption("Parrot Python output")
        self._asset_directory = manifest_path.parent / "assets"
        self.stage = Stage()
        self._sprites = {
            target["name"]: Sprite(self, target, self._asset_directory)
            for target in self._manifest["targets"] if not target["isStage"]
        }
        self._variables = {
            item["id"]: Variable(item) for item in self._manifest.get("variables", [])
        }
        stage_definition = next(
            (target for target in self._manifest["targets"] if target["isStage"]), None
        )
        self._backdrop = _load_image(
            stage_definition.get("asset") if stage_definition else None,
            self._asset_directory,
        )
        self._backdrop = pygame.transform.smoothscale(self._backdrop, (WIDTH, HEIGHT))
        self._green_flag_scripts = []
        self._keys_down = set()
        self._mouse_x = 0
        self._mouse_y = 0
        self._mouse_down = False
        self._stop_requested = False
        self._clock_condition = threading.Condition()
        self._pending_tick_sequences = []
        self._last_tick_sequence = 0
        self._frame_sequence = 0
        self._logical_time_ms = 0
        self._follow_scratch_clock = False
        self._capture = os.environ.get("PARROT_CAPTURE") == "1"
        self._clock_mode = os.environ.get("PARROT_CLOCK_MODE", "internal")

    def sprite(self, name):
        return self.stage if str(name) == "Stage" else self._sprites[str(name)]

    def variable(self, name, owner=None):
        matches = [
            variable for variable in self._variables.values()
            if variable.name == str(name) and (owner is None or variable.owner == str(owner))
        ]
        if len(matches) != 1:
            detail = "missing" if not matches else "ambiguous"
            raise KeyError(f"Scratch variable {name!r} is {detail} in this project")
        return matches[0]

    def variable_by_id(self, variable_id):
        variable_id = str(variable_id)
        if variable_id not in self._variables:
            self._variables[variable_id] = Variable({"id": variable_id, "name": variable_id, "value": 0})
        return self._variables[variable_id]

    def when_green_flag(self, function):
        self._green_flag_scripts.append(function)
        return function

    def next_frame(self):
        return _NextFrame()

    def key_pressed(self, name):
        name = _normalize_key(name)
        if self._capture:
            return bool(self._keys_down) if name == "any" else name in self._keys_down
        pressed = pygame.key.get_pressed()
        if name == "any":
            return any(pressed)
        key_map = {
            "space": pygame.K_SPACE,
            "right arrow": pygame.K_RIGHT,
            "left arrow": pygame.K_LEFT,
            "up arrow": pygame.K_UP,
            "down arrow": pygame.K_DOWN,
            "enter": pygame.K_RETURN,
        }
        key_code = key_map.get(name)
        if key_code is None and len(name) == 1:
            key_code = getattr(pygame, "K_" + name, None)
        return bool(key_code is not None and pressed[key_code])

    def mouse_position(self):
        return self._mouse_x, self._mouse_y

    def _set_mouse(self, message):
        x = _finite_number(message.get("x", 0))
        y = _finite_number(message.get("y", 0))
        self._mouse_x = min(WIDTH / 2, max(-WIDTH / 2, x))
        self._mouse_y = min(HEIGHT / 2, max(-HEIGHT / 2, y))
        self._mouse_down = bool(message.get("isDown", False))

    def _reset(self):
        for variable in self._variables.values():
            variable.reset()
        for sprite in self._sprites.values():
            sprite.reset()

    def _apply_motion_geometry(self, geometry):
        if not isinstance(geometry, dict):
            return
        sprites = geometry.get("sprites")
        if not isinstance(sprites, list) or len(sprites) > 256:
            return
        total_hull_points = 0
        for definition in sprites:
            if not isinstance(definition, dict):
                return
            hull_points = definition.get("hullPoints")
            if not isinstance(hull_points, list):
                return
            total_hull_points += len(hull_points)
            if total_hull_points > 16384:
                return
        for definition in sprites:
            name = definition.get("name")
            if isinstance(name, str) and len(name) <= 100:
                sprite = self._sprites.get(name)
                if sprite:
                    sprite.set_motion_geometry(definition)

    def _read_parrot_input(self):
        for line in sys.stdin:
            try:
                message = json.loads(line)
                if message.get("type") == "key":
                    key = _normalize_key(message.get("key", ""))
                    if message.get("isDown"):
                        self._keys_down.add(key)
                    else:
                        self._keys_down.discard(key)
                elif message.get("type") == "mouse":
                    self._set_mouse(message)
                elif message.get("type") == "tick":
                    sequence = int(message.get("sequence", 0))
                    with self._clock_condition:
                        if sequence > self._last_tick_sequence:
                            keys_down = message.get("keysDown")
                            if isinstance(keys_down, list):
                                self._keys_down = {
                                    _normalize_key(key) for key in keys_down[:64]
                                    if isinstance(key, str) and len(key) <= 40
                                }
                            mouse = message.get("mouse")
                            if isinstance(mouse, dict):
                                self._set_mouse(mouse)
                            self._apply_motion_geometry(message.get("motionGeometry"))
                            self._pending_tick_sequences.append(sequence)
                            self._last_tick_sequence = sequence
                            self._clock_condition.notify()
                elif message.get("type") == "clockMode":
                    clock_mode = message.get("clockMode")
                    if clock_mode in ("internal", "paused"):
                        with self._clock_condition:
                            self._clock_mode = clock_mode
                            self._follow_scratch_clock = False
                            self._frame_sequence = max(
                                self._frame_sequence, self._last_tick_sequence
                            )
                            self._pending_tick_sequences.clear()
                            self._clock_condition.notify_all()
                elif message.get("type") == "stop":
                    with self._clock_condition:
                        self._stop_requested = True
                        self._clock_condition.notify_all()
                    return
            except (ValueError, TypeError):
                continue

    def _wait_for_scratch_tick(self):
        with self._clock_condition:
            while (
                not self._pending_tick_sequences
                and not self._stop_requested
                and self._clock_mode == "scratch"
            ):
                self._clock_condition.wait()
            if self._stop_requested:
                return None
            if self._clock_mode != "scratch":
                return 0
            return self._pending_tick_sequences.pop(0)

    def _wait_while_paused(self):
        with self._clock_condition:
            while self._clock_mode == "paused" and not self._stop_requested:
                self._clock_condition.wait()
            return not self._stop_requested

    def _emit_frame(self, sequence):
        output = io.BytesIO()
        pygame.image.save(self._screen, output, "frame.png")
        encoded = base64.b64encode(output.getvalue()).decode("ascii")
        state = {
            "sprites": [
                {
                    "name": sprite.name,
                    "x": sprite.x if math.isfinite(sprite.x) else 0,
                    "y": sprite.y if math.isfinite(sprite.y) else 0,
                    "direction": sprite.direction if math.isfinite(sprite.direction) else 90,
                }
                for sprite in self._sprites.values()
            ]
        }
        state_json = json.dumps(state, ensure_ascii=True, separators=(",", ":"))
        state_encoded = base64.b64encode(state_json.encode("utf-8")).decode("ascii")
        print(f"{FRAME_PREFIX}{sequence}:{state_encoded}:{encoded}", flush=True)

    def _draw(self):
        self._screen.blit(self._backdrop, (0, 0))
        for sprite in sorted(self._sprites.values(), key=lambda item: item.definition.get("layerOrder", 0)):
            sprite.draw(self._screen)
        pygame.display.flip()

    def run(self):
        self._reset()
        scripts = [function() for function in self._green_flag_scripts]
        if self._capture:
            threading.Thread(target=self._read_parrot_input, daemon=True).start()

        running = True
        next_frame_at = time.perf_counter()
        try:
            while running and not self._stop_requested:
                if self._clock_mode == "paused":
                    if not self._wait_while_paused():
                        break
                    next_frame_at = time.perf_counter()
                    continue
                follow_scratch_clock = self._capture and self._clock_mode == "scratch"
                self._follow_scratch_clock = follow_scratch_clock
                if follow_scratch_clock:
                    frame_sequence = self._wait_for_scratch_tick()
                    if frame_sequence is None:
                        break
                    if frame_sequence == 0:
                        next_frame_at = time.perf_counter()
                        continue
                else:
                    self._frame_sequence += 1
                    frame_sequence = self._frame_sequence
                self._logical_time_ms = _scratch_round(frame_sequence * 1000 / FPS)

                for event in pygame.event.get():
                    if event.type == pygame.QUIT:
                        running = False

                active_scripts = []
                for script in scripts:
                    try:
                        script.send(None)
                        active_scripts.append(script)
                    except StopIteration:
                        pass
                scripts = active_scripts

                self._draw()
                if self._capture:
                    self._emit_frame(frame_sequence)

                if not follow_scratch_clock:
                    next_frame_at += FRAME_SECONDS
                    remaining = next_frame_at - time.perf_counter()
                    if remaining > 0:
                        time.sleep(remaining)
                    else:
                        next_frame_at = time.perf_counter()
        finally:
            for script in scripts:
                script.close()
            pygame.quit()
