# Blender (background) script: build a reduced-polygon LOD of the APEX GT car.
# usage: blender -b --factory-startup -P make_lod.py -- in.glb out.glb ratio
import bpy,sys,json
argv=sys.argv[sys.argv.index('--')+1:]
src,dst,ratio=argv[0],argv[1],float(argv[2])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
FINE={'InteriorShell','DashSoft','SeatFabric','SeatAccent','InteriorAlu','Screen','FloorMat','GrilleHex','ProjLens','LampHousing','BrakeDisc','Caliper','ExhaustInner','LED','TailInner'}
def tris(o):
    m=o.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh();n=sum(len(p.vertices)-2 for p in m.polygons);return n
before=after=0;removed=0;rep=[];done=set()
for o in list(bpy.data.objects):
    if o.type!='MESH':continue
    mats=[s.material.name for s in o.material_slots if s.material]
    # LOD drops parts that are only shown up close
    if mats and all(m in FINE for m in mats):
        removed+=tris(o);bpy.data.objects.remove(o,do_unlink=True);continue
    t0=tris(o);before+=t0
    if o.data.name in done:t1=tris(o);after+=t1;continue
    done.add(o.data.name)
    if t0>200 and o.data.users>1:
        # shared mesh (e.g. 4 wheels): decimate the mesh data once through a temporary single-user object
        tmp=o.copy();tmp.data=o.data;bpy.context.scene.collection.objects.link(tmp)
        mod=tmp.modifiers.new('dec','DECIMATE');mod.decimate_type='COLLAPSE';mod.ratio=ratio if t0>1500 else min(1.0,ratio*2);mod.use_collapse_triangulate=True
        dg=bpy.context.evaluated_depsgraph_get();new=bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
        for m2 in [x for x in bpy.data.objects if x.data==o.data and x is not tmp]:m2.data=new
        bpy.data.objects.remove(tmp,do_unlink=True)
    elif t0>200:
        r=ratio if t0>1500 else min(1.0,ratio*2)
        mod=o.modifiers.new('dec','DECIMATE');mod.decimate_type='COLLAPSE';mod.ratio=r;mod.use_collapse_triangulate=True
        bpy.context.view_layer.objects.active=o
        for x in bpy.context.selected_objects:x.select_set(False)
        o.select_set(True);bpy.ops.object.modifier_apply(modifier='dec')
    t1=tris(o);after+=t1;rep.append((o.name,mats[:2],t0,t1))
bpy.ops.export_scene.gltf(filepath=dst,export_format='GLB',export_draco_mesh_compression_enable=False,export_apply=True,export_yup=True)
print('LODREPORT',json.dumps({'kept_before':before,'kept_after':after,'removed_fine':removed,'objects':sorted(rep,key=lambda x:-x[2])[:15]}))
