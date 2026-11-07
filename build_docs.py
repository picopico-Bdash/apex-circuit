"""Build the GitHub Pages site in docs/ from game.html + src/shell.html.
Models are served as binary .glb files and loaded with fetch() instead of inline base64."""
import base64,pathlib,re,shutil
d=pathlib.Path(__file__).parent
out=d/'docs'; (out/'js').mkdir(parents=True,exist_ok=True); (out/'models').mkdir(exist_ok=True)
g=(d/'game.html').read_text(encoding='utf-8')
js=re.search(r'<script>\n(.*?)</script>',g,re.S).group(1)

old_car=js[js.index('(function loadModel(){'):js.index('(function loadProps(){')]
new_car='''(function loadModel(){
  if(!THREE.GLTFLoader){setModelStatus('車体モデル：読み込めませんでした（簡易マシンで走行します）',false);return;}
  setModelStatus('車体モデル：読み込み中…',false);
  const fail=e=>{setModelStatus('車体モデル：読み込みに失敗しました（簡易マシンで走行します）',false);console.error(e);};
  fetch('models/apex.glb').then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.arrayBuffer();}).then(buf=>{
    new THREE.GLTFLoader().parse(buf,'',g=>{applyModel(g);setModelStatus('車体モデル：APEX GT（GTウイング・角型バンパー・ハニカムグリル・丸型4灯テール・ディテールアップ）読み込み完了',true);},fail);
  }).catch(fail);
})();

'''
js=js.replace(old_car,new_car,1)
i=js.index('(function loadProps(){');j=js.index('})();',i)+5
new_props='''(function loadProps(){
  if(!THREE.GLTFLoader)return;
  fetch('models/props.glb').then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.arrayBuffer();}).then(buf=>{
    new THREE.GLTFLoader().parse(buf,'',g=>{PROPS=buildPropLib(g.scene);texturizeTrees(PROPS);texturizeBuildings(PROPS);decorate();},e=>console.error(e));
  }).catch(e=>console.error(e));
})();'''
js=js[:i]+new_props+js[j:]
assert 'apexModel' not in js and 'propsModel' not in js
(out/'js'/'game.js').write_text(js,encoding='utf-8',newline='\n')
shutil.copy(d/'src'/'shell.html',out/'index.html')
(out/'.nojekyll').write_text('')
# models: props from the artifact blob; car model from models_src/apex.b64 if present
p=(d/'_props.txt').read_text(encoding='utf-8').split('\n')[0]
p=p[p.index('>')+1:p.rindex('</script>')]
(out/'models'/'props.glb').write_bytes(base64.b64decode(p))
car=d/'models_src'/'apex.b64'
if car.exists():(out/'models'/'apex.glb').write_bytes(base64.b64decode(car.read_text(encoding='ascii').strip()))
print('built; car model:', car.exists())
