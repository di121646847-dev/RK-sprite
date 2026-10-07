extends SceneTree


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	var preview: PackedScene = load("res://rk_sprite/TEST_SLUG/preview.tscn") as PackedScene
	if preview == null:
		quit(13)
		return
	var preview_instance: Node = preview.instantiate()
	if preview_instance.get_node_or_null("Camera2D") == null:
		preview_instance.free()
		quit(13)
		return
	preview_instance.free()
	var scene: PackedScene = load("res://rk_sprite/TEST_SLUG/player.tscn") as PackedScene
	if scene == null:
		quit(1)
		return
	var actor: Node2D = scene.instantiate() as Node2D
	root.add_child(actor)
	await process_frame
	if actor.current_animation != "run" or actor.current_frame_index != 0:
		quit(2)
		return
	var body: Sprite2D = actor.get_node("Body") as Sprite2D
	if body == null or body.region_rect.size != Vector2(32, 32):
		quit(3)
		return
	if actor._equipment.size() != 1:
		quit(4)
		return
	if actor.available_equipment("upper") != ["Coat"]:
		quit(14)
		return
	var overlay: Sprite2D = actor._equipment.values()[0] as Sprite2D
	if overlay.z_index >= body.z_index:
		quit(5)
		return
	actor.show_frame("run", 1)
	if overlay.z_index <= body.z_index or actor.current_frame_index != 1:
		quit(6)
		return
	actor.set_equipment("upper", "")
	if overlay.visible:
		quit(7)
		return
	actor.set_equipment("upper", "Coat")
	if not overlay.visible:
		quit(8)
		return
	actor.play_animation("run", true, true)
	actor._process(0.045)
	if actor.current_frame_index != 1:
		quit(9)
		return
	actor.play_animation("run")
	if actor.current_frame_index != 1:
		quit(10)
		return
	actor._process(0.045)
	if actor.current_frame_index != 0:
		quit(11)
		return
	actor.play_animation("run", false, true)
	actor._process(0.5)
	if actor.current_frame_index != 1 or actor._playing:
		quit(12)
		return
	print("RK sprite Godot runtime probe passed")
	quit(0)
