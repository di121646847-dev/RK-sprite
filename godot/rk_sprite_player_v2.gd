extends Node2D

signal frame_changed(animation_id: String, frame_index: int, frame_id: String)
signal animation_finished(animation_id: String)

@export_file("*.json") var data_file: String
@export var autoplay: bool = true

var current_animation: String = ""
var current_frame_index: int = 0
var _elapsed_ms: float = 0.0
var _loop: bool = true
var _playing: bool = false
var _canvas_size: Vector2 = Vector2.ZERO
var _actions: Dictionary = {}
var _textures: Dictionary = {}
var _equipped: Dictionary = {}
var _body: Sprite2D
var _equipment: Dictionary = {}


func _ready() -> void:
	_body = Sprite2D.new()
	_body.name = "Body"
	_body.centered = false
	_body.region_enabled = true
	add_child(_body)
	load_data(data_file)


func load_data(path: String) -> bool:
	if path.is_empty() or not FileAccess.file_exists(path):
		push_error("RK sprite: animation data not found: " + path)
		return false
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if not parsed is Dictionary or parsed.get("schemaVersion", 0) != 1:
		push_error("RK sprite: invalid animation data")
		return false
	_actions = parsed.get("actions", {})
	var canvas: Dictionary = parsed.get("canvas", {})
	_canvas_size = Vector2(float(canvas.get("width", 0)), float(canvas.get("height", 0)))
	if _actions.is_empty() or _canvas_size.x <= 0.0 or _canvas_size.y <= 0.0:
		push_error("RK sprite: no playable frames")
		return false
	_textures.clear()
	_equipped.clear()
	for action_id in _actions:
		var action: Dictionary = _actions[action_id]
		for entry in action.get("layers", []):
			var layer: Dictionary = entry
			var slot: String = str(layer.get("slot", "outfit"))
			if not _equipped.has(slot) and layer.get("defaultVisible", true):
				_equipped[slot] = str(layer.get("name", ""))
	data_file = path
	var first_action: String = str(_actions.keys()[0])
	return play_animation(first_action, true, true) if autoplay else show_frame(first_action, 0)


func play_animation(animation_id: String, loop: bool = true, restart: bool = false) -> bool:
	if not _actions.has(animation_id):
		return false
	if current_animation == animation_id and not restart:
		return true
	current_animation = animation_id
	current_frame_index = 0
	_elapsed_ms = 0.0
	_loop = loop
	_playing = true
	_show_current_frame()
	return true


func show_frame(animation_id: String, frame_index: int) -> bool:
	if not _actions.has(animation_id):
		return false
	var action: Dictionary = _actions[animation_id]
	var frames: Array = action.get("frames", [])
	if frame_index < 0 or frame_index >= frames.size():
		return false
	current_animation = animation_id
	current_frame_index = frame_index
	_elapsed_ms = 0.0
	_playing = false
	_show_current_frame()
	return true


func set_equipment(slot: String, variant: String) -> void:
	_equipped[slot] = variant
	_show_current_frame()


func get_equipment(slot: String) -> String:
	return str(_equipped.get(slot, ""))


func available_equipment(slot: String) -> Array[String]:
	var names: Array[String] = []
	for action in _actions.values():
		for entry in action.get("layers", []):
			var layer: Dictionary = entry
			if str(layer.get("slot", "outfit")) != slot:
				continue
			var name: String = str(layer.get("name", ""))
			if not names.has(name):
				names.append(name)
	return names


func set_playing(enabled: bool) -> void:
	_playing = enabled and not current_animation.is_empty()


func _process(delta: float) -> void:
	if not _playing or not _actions.has(current_animation):
		return
	var action: Dictionary = _actions[current_animation]
	var frames: Array = action.get("frames", [])
	if frames.is_empty():
		return
	_elapsed_ms += delta * 1000.0 * float(action.get("playbackSpeed", 1.0))
	var steps: int = 0
	while _elapsed_ms >= float(frames[current_frame_index].get("durationMs", 83)) and steps < 512:
		_elapsed_ms -= float(frames[current_frame_index].get("durationMs", 83))
		if current_frame_index == frames.size() - 1 and not _loop:
			_playing = false
			animation_finished.emit(current_animation)
			return
		current_frame_index = (current_frame_index + 1) % frames.size()
		steps += 1
		_show_current_frame()


func _sheet(image_name: String) -> Texture2D:
	if not _textures.has(image_name):
		var resource_path: String = data_file.get_base_dir().path_join(image_name)
		_textures[image_name] = load(resource_path) as Texture2D
	return _textures[image_name] as Texture2D


func _configure(sprite: Sprite2D, texture: Texture2D, index: int) -> void:
	sprite.texture = texture
	sprite.visible = texture != null
	if texture == null:
		return
	var columns: int = max(1, int(texture.get_width() / _canvas_size.x))
	var column: int = index % columns
	var row: int = index / columns
	sprite.region_rect = Rect2(column * _canvas_size.x, row * _canvas_size.y, _canvas_size.x, _canvas_size.y)
	sprite.position = Vector2(-_canvas_size.x * 0.5, -_canvas_size.y)


func _show_current_frame() -> void:
	if not _actions.has(current_animation):
		return
	var action: Dictionary = _actions[current_animation]
	var frames: Array = action.get("frames", [])
	if current_frame_index >= frames.size():
		return
	_configure(_body, _sheet(str(action.get("body", ""))), current_frame_index)
	for sprite in _equipment.values():
		(sprite as Sprite2D).visible = false
	var layer_index: int = 0
	for entry in action.get("layers", []):
		var layer: Dictionary = entry
		var slot: String = str(layer.get("slot", "outfit"))
		if str(_equipped.get(slot, "")) != str(layer.get("name", "")) and str(_equipped.get(slot, "")) != str(layer.get("id", "")):
			layer_index += 1
			continue
		var layer_frames: Array = layer.get("frames", [])
		if current_frame_index >= layer_frames.size():
			continue
		var layer_frame: Dictionary = layer_frames[current_frame_index]
		if not layer_frame.get("present", false):
			continue
		var key: String = str(layer.get("id", ""))
		if not _equipment.has(key):
			var sprite: Sprite2D = Sprite2D.new()
			sprite.name = "Equipment_" + str(_equipment.size())
			sprite.centered = false
			sprite.region_enabled = true
			add_child(sprite)
			_equipment[key] = sprite
		var overlay: Sprite2D = _equipment[key] as Sprite2D
		_configure(overlay, _sheet(str(layer.get("image", ""))), current_frame_index)
		overlay.z_index = (-100 + layer_index) if layer_frame.get("behind", false) else (1 + layer_index)
		layer_index += 1
	var current: Dictionary = frames[current_frame_index]
	frame_changed.emit(current_animation, current_frame_index, str(current.get("id", "")))
