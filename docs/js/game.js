(function(){
"use strict";
const $=id=>document.getElementById(id);
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const wrapA=a=>{while(a>Math.PI)a-=Math.PI*2;while(a<-Math.PI)a+=Math.PI*2;return a;};
const IS_TOUCH=(window.matchMedia&&matchMedia('(pointer: coarse)').matches)||('ontouchstart' in window);
if(IS_TOUCH){document.body.classList.add('is-touch');$('keysPC').hidden=true;$('keysTouch').hidden=false;
  const sp=document.querySelector('.hud-speed');sp.classList.add('chip');document.querySelector('.hud-tl').appendChild(sp);}

/* ================= Quality (auto / high / low) ================= */
// Without a GPU the browser rasterises WebGL on the CPU (SwiftShader, llvmpipe...). Cost there is roughly
// pixels x shader work, so the low preset renders fewer pixels, drops shadows and bump maps, shortens the
// draw distance, thins out trees/particles and caps the frame rate at 30 fps. Physics and AI are unchanged.
const QKEY='apexcircuit-quality';
let QPREF='auto';
try{QPREF=localStorage.getItem(QKEY)||'auto';}catch(e){}
{const q=new URLSearchParams(location.search).get('quality');if(q==='auto'||q==='high'||q==='low')QPREF=q;}
const GPU_INFO=(()=>{try{
  const strict=document.createElement('canvas').getContext('webgl',{failIfMajorPerformanceCaveat:true});
  const gl=strict||document.createElement('canvas').getContext('webgl');
  if(!gl)return {soft:true,name:'WebGL unavailable'};
  const ext=gl.getExtension('WEBGL_debug_renderer_info');
  const name=String(gl.getParameter(ext?ext.UNMASKED_RENDERER_WEBGL:gl.RENDERER));
  const soft=!strict||/swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
  const lose=gl.getExtension('WEBGL_lose_context');if(lose)lose.loseContext();
  return {soft,name};
}catch(e){return {soft:false,name:'?'};}})();
const LOW=QPREF==='low'||(QPREF==='auto'&&GPU_INFO.soft);

/* ================= Renderer / Scene ================= */
const renderer=new THREE.WebGLRenderer({antialias:!IS_TOUCH&&!LOW,powerPreference:'high-performance'});
// render scale: LOW starts at 60 % of 1x and dynamic resolution (qualityTick) adapts it to the frame time
const DPR_BASE=LOW?Math.min(window.devicePixelRatio||1,1):Math.min(window.devicePixelRatio||1,IS_TOUCH?1.5:2);
let renderScale=LOW?0.6:1;
renderer.setPixelRatio(DPR_BASE*renderScale);
renderer.shadowMap.enabled=!LOW;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
$('stage').appendChild(renderer.domElement);
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(62,1,0.1,LOW?430:4200);
const FOG=0xbfd2e2;
scene.fog=new THREE.Fog(FOG,220,1700);

const skyMat=new THREE.ShaderMaterial({
  side:THREE.BackSide,depthWrite:false,fog:false,
  uniforms:{top:{value:new THREE.Color(0x3b78cc)},mid:{value:new THREE.Color(0xb7d0e6)},bot:{value:new THREE.Color(0xc9d6df)}},
  vertexShader:'varying vec3 vP;void main(){vP=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader:'uniform vec3 top;uniform vec3 mid;uniform vec3 bot;varying vec3 vP;void main(){float h=vP.y;vec3 c=h>0.0?mix(mid,top,pow(clamp(h,0.0,1.0),0.55)):mix(mid,bot,clamp(-h*4.0,0.0,1.0));gl_FragColor=vec4(c,1.0);}'
});
const sky=new THREE.Mesh(new THREE.SphereGeometry(3200,32,16),skyMat);
if(LOW)sky.scale.setScalar(0.12);   // keep the sky inside the shorter LOW far plane
scene.add(sky);
// environment reflections from the sky
const envGen=(()=>{
  // reflections are prefiltered from an equirectangular gradient drawn on a canvas with the sky colours.
  // (Rendering the sky ShaderMaterial into the PMREM target skipped output encoding, which blew the
  //  reflections out to white on GPUs where the target falls back to RGBE.)
  const pm=new THREE.PMREMGenerator(renderer),cv=document.createElement('canvas');cv.width=64;cv.height=64;
  const g=cv.getContext('2d'),img=g.createImageData(64,64),t=new THREE.Color(),a=new THREE.Color();
  let rt=null;
  return ()=>{const U=skyMat.uniforms;
    for(let y=0;y<64;y++){const h=1-2*(y+0.5)/64;   // +1 at the top row, -1 at the bottom
      if(h>0)t.copy(U.mid.value).lerp(U.top.value,Math.pow(h,0.55));else t.copy(U.mid.value).lerp(U.bot.value,Math.min(1,-h*4));
      for(let x=0;x<64;x++){const k=(y*64+x)*4;img.data[k]=t.r*255;img.data[k+1]=t.g*255;img.data[k+2]=t.b*255;img.data[k+3]=255;}}
    g.putImageData(img,0,0);
    const tex=new THREE.CanvasTexture(cv);tex.mapping=THREE.EquirectangularReflectionMapping;
    if(rt)rt.dispose();rt=pm.fromEquirectangular(tex);tex.dispose();scene.environment=rt.texture;};
})();
envGen();

const hemi=new THREE.HemisphereLight(0xd6e6ff,0x4d5a3c,0.62);
scene.add(hemi);
const sun=new THREE.DirectionalLight(0xfff0d8,1.15);
sun.castShadow=true;
const SM=IS_TOUCH?1024:2048;
sun.shadow.mapSize.set(SM,SM);
const sc=sun.shadow.camera;sc.left=-55;sc.right=55;sc.top=55;sc.bottom=-55;sc.near=10;sc.far=400;
sun.shadow.bias=-0.0006;
scene.add(sun);scene.add(sun.target);

/* ================= Textures ================= */
function canvasTex(w,h,draw,rep){
  const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');draw(g,w,h);
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;
  if(rep)t.repeat.set(rep[0],rep[1]);
  t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
  return t;
}
function speckle(g,w,h,n,cols,size){for(let i=0;i<n;i++){g.fillStyle=cols[(Math.random()*cols.length)|0];const s=size*(0.5+Math.random());g.fillRect(Math.random()*w,Math.random()*h,s,s);}}
// ---- procedural, tileable surface textures (no image files needed) ----
function rng(seed){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
// periodic value noise + fBm so every texture wraps seamlessly
function makeNoise(seed,cells){
  const R=rng(seed),T=new Float32Array(cells*cells);for(let i=0;i<T.length;i++)T[i]=R();
  return (u,v)=>{ // u,v in [0,1)
    const x=u*cells,y=v*cells,xi=Math.floor(x),yi=Math.floor(y),fx=x-xi,fy=y-yi;
    const a=T[((yi%cells+cells)%cells)*cells+((xi%cells+cells)%cells)],b=T[((yi%cells+cells)%cells)*cells+(((xi+1)%cells+cells)%cells)];
    const c=T[(((yi+1)%cells+cells)%cells)*cells+((xi%cells+cells)%cells)],d=T[(((yi+1)%cells+cells)%cells)*cells+(((xi+1)%cells+cells)%cells)];
    const sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy);
    return a+(b-a)*sx+(c-a)*sy+(a-b-c+d)*sx*sy;
  };
}
function fbm(seed,base,oct){const ns=[];for(let o=0;o<oct;o++)ns.push(makeNoise(seed+o*101,base<<o));return (u,v)=>{let s=0,amp=0.5,tot=0;for(const n of ns){s+=n(u,v)*amp;tot+=amp;amp*=0.5;}return s/tot;};}
function pixelTex(w,h,shade,rep){
  return canvasTex(w,h,(g)=>{
    const im=g.createImageData(w,h),d=im.data;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const c=shade(x/w,y/h,x,y),i=(y*w+x)*4;d[i]=c[0];d[i+1]=c[1];d[i+2]=c[2];d[i+3]=255;}
    g.putImageData(im,0,0);
  },rep);
}
const TEXQ=IS_TOUCH?256:512;
// asphalt: u = across the road (edge to edge), v = 12 m along it
const asphaltTex=(()=>{
  const W2=TEXQ,H2=TEXQ,big=fbm(11,4,4),mid=fbm(23,16,3),R=rng(5);
  const t=pixelTex(W2,H2,(u,v,x,y)=>{
    let l=0.275+(big(u,v)-0.5)*0.10+(mid(u,v)-0.5)*0.07;
    const r=R();l+=(r-0.5)*0.06;if(r>0.988)l+=0.11;else if(r<0.012)l-=0.07;  // aggregate stones
    // rubbered-in racing line: darker band with soft edges
    const band=Math.exp(-Math.pow((u-0.5)/0.17,2));l-=band*0.09*(0.7+0.6*mid(u*2,v));
    const c=Math.max(0,Math.min(1,l))*255;return [c*0.97,c*0.985,c*1.02];
  });
  const g=t.image.getContext('2d');
  // tar-sealed cracks
  g.strokeStyle='rgba(18,19,21,.55)';g.lineWidth=Math.max(1,W2/400);
  for(let k=0;k<5;k++){let x=R()*W2,y=R()*H2;g.beginPath();g.moveTo(x,y);for(let s2=0;s2<14;s2++){x+=(R()-0.5)*W2*0.05;y+=R()*H2*0.05;g.lineTo(x,y);}g.stroke();}
  // skid marks inside the racing line
  for(let k=0;k<7;k++){const x=W2*(0.38+R()*0.24),y=R()*H2,len=H2*(0.2+R()*0.5),w=W2*(0.006+R()*0.01);
    const gr=g.createLinearGradient(0,y,0,y+len);gr.addColorStop(0,'rgba(10,10,12,0)');gr.addColorStop(.3,'rgba(10,10,12,.28)');gr.addColorStop(1,'rgba(10,10,12,0)');
    g.fillStyle=gr;g.fillRect(x,y,w,len);g.fillRect(x+W2*0.05,y+H2*0.01,w,len*0.9);if(y+len>H2){g.fillRect(x,y-H2,w,len);g.fillRect(x+W2*0.05,y-H2+H2*0.01,w,len*0.9);}}
  // worn white edge lines
  const lw=Math.round(W2*0.012),lx=Math.round(W2*0.012);
  for(const x0 of [lx,W2-lx-lw]){for(let y=0;y<H2;y+=2){const a=0.78+R()*0.2;g.fillStyle='rgba(236,238,240,'+a.toFixed(2)+')';g.fillRect(x0,y,lw,2);}}
  t.needsUpdate=true;return t;
})();
// grass: 16.7 m tiles with mowing stripes, clumps and blade strokes
const grassTex=(()=>{
  const S=TEXQ,big=fbm(31,4,4),mid=fbm(37,24,3),R=rng(9);
  const t=pixelTex(S,S,(u,v)=>{
    const stripe=(u<0.5?1:0)*0.06-0.03;
    let k=1+(big(u,v)-0.5)*0.22+(mid(u,v)-0.5)*0.16+stripe+(R()-0.5)*0.10;
    return [72*k,118*k,50*k];
  },[420,420]);
  const g=t.image.getContext('2d');
  for(let i=0;i<S*S/22;i++){const x=R()*S,y=R()*S,l=2+R()*4,a=R()*6.28;
    const c=R()<0.5?'rgba(40,78,28,.45)':'rgba(132,170,86,.35)';g.strokeStyle=c;g.lineWidth=1;g.beginPath();g.moveTo(x,y);g.lineTo(x+Math.cos(a)*l*0.3,y-l);g.stroke();}
  t.needsUpdate=true;return t;
})();
// gravel trap / run-off: u = across the strip (5 m), v = 8 m along
const gravelTex=(()=>{
  const S=TEXQ/2,big=fbm(41,4,3),R=rng(17);
  const t=pixelTex(S,S,(u,v)=>{const k=0.95+(big(u,v)-0.5)*0.25+(R()-0.5)*0.18;return [150*k,136*k,110*k];});
  const g=t.image.getContext('2d');const cols=['#b9ab8e','#7b6d58','#cfc4ad','#5e554a','#a39274','#8e8a82'];
  for(let i=0;i<S*S/5;i++){const x=R()*S,y=R()*S,r=0.6+R()*1.6;
    g.fillStyle='rgba(30,26,20,.35)';g.beginPath();g.arc(x+0.6,y+0.7,r,0,6.28);g.fill();
    g.fillStyle=cols[(R()*cols.length)|0];g.beginPath();g.arc(x,y,r,0,6.28);g.fill();}
  t.needsUpdate=true;return t;
})();
const checkerTex=canvasTex(256,32,(g,w,h)=>{
  const s=16;for(let y=0;y<h/s;y++)for(let x=0;x<w/s;x++){g.fillStyle=(x+y)%2?'#111':'#f2f2f2';g.fillRect(x*s,y*s,s,s);}
});
const carbonTex=canvasTex(64,64,(g,w,h)=>{
  // 2x2 twill: alternating light/dark tows, each with a soft sheen gradient
  const n=8,s=w/n;
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const horiz=((x+y)>>1)%2===0;
    const gr=horiz?g.createLinearGradient(x*s,y*s,x*s,y*s+s):g.createLinearGradient(x*s,y*s,x*s+s,y*s);
    const a=horiz?'#3a3d42':'#202226',b=horiz?'#55595f':'#2c2f34';
    gr.addColorStop(0,a);gr.addColorStop(.5,b);gr.addColorStop(1,a);g.fillStyle=gr;g.fillRect(x*s,y*s,s,s);
  }
});
const crowdTex=canvasTex(256,64,(g,w,h)=>{
  g.fillStyle='#5b6470';g.fillRect(0,0,w,h);
  speckle(g,w,h,1400,['#d9473b','#f2c14e','#3e7dd6','#f1f1f1','#2f2f35','#57a773','#e98a3a','#8d5fd3'],5);
},[6,1]);


/* ================= Circuit props (Blender models, instanced) ================= */
// grandstand, pit building, start gantry, tyre walls, catch fences, billboards, marshal posts and trees
function buildPropLib(root){
  const lib={};root.updateMatrixWorld(true);
  const seen=new Set();
  root.traverse(o=>{if(o.isMesh&&!seen.has(o.material)){seen.add(o.material);o.material.color.convertLinearToSRGB();if(o.material.emissive)o.material.emissive.convertLinearToSRGB();}});
  root.children.forEach(prop=>{
    if(!/^Prop_/.test(prop.name))return;
    const inv=new THREE.Matrix4().copy(prop.matrixWorld).invert(),parts=[];
    prop.traverse(o=>{if(!o.isMesh)return;const g=o.geometry.clone();g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv,o.matrixWorld));parts.push({g,m:o.material});});
    lib[prop.name]=parts;
  });
  return lib;
}
const _pm=new THREE.Matrix4(),_pq=new THREE.Quaternion(),_ps=new THREE.Vector3(),_pp=new THREE.Vector3(),_Yax=new THREE.Vector3(0,1,0);
function propMat(x,y,z,h,sx,sy,sz){_pp.set(x,y,z);_pq.setFromAxisAngle(_Yax,h);_ps.set(sx||1,sy||sx||1,sz||sx||1);return new THREE.Matrix4().compose(_pp,_pq,_ps);}
/*
 * Shadow casters keep 160 m cells so the small, car-following shadow frustum
 * does not make large instance batches expensive. Non-casters with cheap
 * geometry can use 640 m cells; dense parts retain 160 m cells for useful
 * frustum culling.
 */
function instProp(name,mats,shadow){
  const parts=PROPS[name];if(!parts||!mats.length)return;
  const v=new THREE.Vector3();
  for(const pt of parts){
    const triCount=pt.g.index?pt.g.index.count/3:(pt.g.attributes.position.count/3);
    const cellSize=LOW?1e6:(!shadow&&triCount<=300?640:160);   // LOW has no shadow pass: fewer, larger batches
    const cells=new Map();
    for(const m of mats){v.setFromMatrixPosition(m);const key=Math.floor(v.x/cellSize)+','+Math.floor(v.z/cellSize);if(!cells.has(key))cells.set(key,[]);cells.get(key).push(m);}
    if(!pt.g.boundingSphere)pt.g.computeBoundingSphere();
    const r0=pt.g.boundingSphere.radius,c0=pt.g.boundingSphere.center;
    cells.forEach(list=>{
      const g=new THREE.BufferGeometry();
      for(const k in pt.g.attributes)g.setAttribute(k,pt.g.attributes[k]);
      if(pt.g.index)g.setIndex(pt.g.index);
      const box=new THREE.Box3();let rmax=0;
      for(const m of list){const c=c0.clone().applyMatrix4(m);box.expandByPoint(c);rmax=Math.max(rmax,r0*m.getMaxScaleOnAxis());}
      const sph=new THREE.Sphere();box.getBoundingSphere(sph);sph.radius+=rmax;g.boundingSphere=sph;
      const im=new THREE.InstancedMesh(g,pt.m,list.length);
      if(pt.m.userData.depth)im.customDepthMaterial=pt.m.userData.depth;
      list.forEach((m,i)=>im.setMatrixAt(i,m));
      if(LOW){   // keep every matrix + ground position; decorCull() packs only the nearby ones into the live buffer
        im.userData.all=im.instanceMatrix.array.slice();const P=new Float32Array(list.length*2);
        list.forEach((m,i)=>{P[i*2]=m.elements[12];P[i*2+1]=m.elements[14];});im.userData.pos=P;
        (decorGroup.userData.cull||(decorGroup.userData.cull=[])).push(im);
      }
      im.castShadow=!!shadow;im.receiveShadow=!pt.m.userData.noReceive;im.matrixAutoUpdate=false;im.updateMatrix();
      decorGroup.add(im);
    });
  }
}

/* ---- tree textures: bark, pine needles and broad leaves, mapped cylindrically around the trunk ---- */
const barkTex=(()=>{
  const W2=128,H2=256,fis=makeNoise(61,10),fis2=makeNoise(67,24),big=fbm(71,4,3),R=rng(33);
  return pixelTex(W2,H2,(u,v)=>{
    // vertical fissures: noise stretched along the trunk
    const f=Math.min(fis(u,v*0.18),fis2(u,v*0.25)*1.1);
    let k=0.55+(big(u,v)-0.5)*0.35+(R()-0.5)*0.12;
    if(f<0.32)k*=0.45+f;            // dark cracks
    else if(f>0.78)k*=1.18;         // lit ridges
    return [92*k,64*k,42*k];
  });
})();
// crown cut-outs (transparent background) drawn onto canvases
function crownTex(kind){
  const Wc=256,Hc=kind==='pine'?512:384,c=document.createElement('canvas');c.width=Wc;c.height=Hc;const g=c.getContext('2d'),R=rng(kind==='pine'?81:91);
  const greens=kind==='pine'?['#123a1c','#1b4a24','#24592b','#2f6a33','#3c7a3c','#4f8c45']:['#22461a','#2e5a20','#3b6c27','#4a7f2f','#5f9238','#78a64a'];
  if(kind==='pine'){
    // tiers of drooping needle clusters, wider at the bottom
    const tiers=7;
    for(let t2=0;t2<tiers;t2++){
      const yb=Hc*(0.98-t2*0.125),yt=yb-Hc*0.22,half=Wc*0.47*(1-t2/tiers*0.85);
      for(let i=0;i<900;i++){
        const f=R(),y=yt+(yb-yt)*Math.pow(f,0.8),w=half*Math.pow((y-yt)/(yb-yt),0.9)*(0.75+R()*0.35);
        const x=Wc/2+(R()*2-1)*w;
        const shade=Math.min(greens.length-1,Math.max(0,Math.floor((1-(y-yt)/(yb-yt))*3+R()*3)));
        g.strokeStyle=greens[shade];g.lineWidth=1.2+R()*1.6;
        const l=5+R()*10,a=Math.PI/2+(x<Wc/2?0.6:-0.6)+(R()-0.5)*0.8;
        g.beginPath();g.moveTo(x,y);g.lineTo(x+Math.cos(a)*l,y+Math.sin(a)*l*0.6);g.stroke();
      }
    }
  }else{
    // rounded crown built from overlapping leaf clumps
    const blobs=[[0.5,0.55,0.42],[0.30,0.62,0.26],[0.70,0.60,0.27],[0.5,0.30,0.30],[0.36,0.40,0.24],[0.64,0.38,0.24],[0.5,0.78,0.22]];
    for(const [bx,by,br] of blobs){
      for(let i=0;i<1700;i++){
        const a=R()*6.283,r=Math.sqrt(R())*br*Wc,x=bx*Wc+Math.cos(a)*r,y=by*Hc+Math.sin(a)*r*0.9;
        const lit=(y<by*Hc?1:0)+(x>bx*Wc?1:0)+R()*2.5;
        g.fillStyle=greens[Math.min(greens.length-1,Math.floor(lit*1.3))];
        const rr=2.5+R()*4;g.beginPath();g.ellipse(x,y,rr,rr*0.6,R()*3.14,0,6.283);g.fill();
      }
    }
  }
  // darken the lower part so the crown reads as lit from above
  g.globalCompositeOperation='source-atop';const gr=g.createLinearGradient(0,0,0,Hc);gr.addColorStop(0,'rgba(255,255,220,.10)');gr.addColorStop(1,'rgba(0,0,0,.35)');g.fillStyle=gr;g.fillRect(0,0,Wc,Hc);
  const t=new THREE.CanvasTexture(c);t.anisotropy=4;return t;
}
// one leaf-cluster sprite for the broadleaf cards (transparent background)
function leafCardTex(){
  // individual leaves on little twigs, with see-through gaps between them
  const S=256,c=document.createElement('canvas');c.width=S;c.height=S;const g=c.getContext('2d'),R=rng(97);
  const greens=['#24471a','#2e5920','#3a6a27','#477c2e','#5a8f37','#73a447'];
  const leaf=(x,y,len,ang,col)=>{
    g.save();g.translate(x,y);g.rotate(ang);g.fillStyle=col;
    g.beginPath();g.moveTo(0,0);g.quadraticCurveTo(len*0.5,-len*0.32,len,0);g.quadraticCurveTo(len*0.5,len*0.32,0,0);g.fill();
    g.strokeStyle='rgba(20,40,14,.55)';g.lineWidth=0.8;g.beginPath();g.moveTo(len*0.08,0);g.lineTo(len*0.9,0);g.stroke();
    g.restore();
  };
  for(let tw=0;tw<16;tw++){
    // a twig running from near the centre outwards, leaves alternating along it
    const a0=R()*6.283,x0=S/2+(R()-0.5)*S*0.25,y0=S/2+(R()-0.5)*S*0.25,L=S*(0.25+R()*0.2);
    const x1=x0+Math.cos(a0)*L,y1=y0+Math.sin(a0)*L;
    g.strokeStyle='#4a3524';g.lineWidth=1.6;g.beginPath();g.moveTo(x0,y0);g.lineTo(x1,y1);g.stroke();
    const n=12+Math.floor(R()*7);
    for(let i=0;i<n;i++){
      const t=0.15+0.85*i/n,x=x0+(x1-x0)*t,y=y0+(y1-y0)*t,side=(i%2?1:-1);
      const lit=(y<S/2?1.4:0.2)+R()*2.4;
      leaf(x,y,17+R()*13,a0+side*(0.6+R()*0.5),greens[Math.min(greens.length-1,Math.floor(lit*1.2))]);
    }
    leaf(x1,y1,19+R()*9,a0+(R()-0.5)*0.4,greens[3+Math.floor(R()*3)]);
  }
  // no mipmaps: averaged mip levels would fade the thin leaves away below the alpha cut-off at distance
  const t=new THREE.CanvasTexture(c);t.anisotropy=4;t.generateMipmaps=false;t.minFilter=THREE.LinearFilter;return t;
}
// foliage lights as one rounded mass: normals come from the crown centre, and back faces are not darkened
function foliageMat(map){
  const m=new THREE.MeshStandardMaterial({map,alphaTest:0.45,side:THREE.DoubleSide,roughness:0.9});
  m.onBeforeCompile=sh=>{sh.fragmentShader=sh.fragmentShader.replace('#include <normal_fragment_begin>',THREE.ShaderChunk.normal_fragment_begin.replace('normal = normal * faceDirection;',''));};
  m.userData.depth=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,map,alphaTest:0.45,side:THREE.DoubleSide});
  m.userData.noReceive=true;   // leaves do not shadow each other into dark bands
  return m;
}
function sphericalNormals(g,cx,cy,cz,flat){
  const P=g.attributes.position,n=new Float32Array(P.count*3),v=new THREE.Vector3();
  for(let i=0;i<P.count;i++){v.set((P.getX(i)-cx)*(flat||1),P.getY(i)-cy+0.6,(P.getZ(i)-cz)*(flat||1)).normalize();n[i*3]=v.x;n[i*3+1]=v.y;n[i*3+2]=v.z;}
  g.setAttribute('normal',new THREE.BufferAttribute(n,3));
}
// five vertical quads crossed every 36 degrees: a decagon seen from above
function crossGeo(width,y0,y1){
  const pos=[],nor=[],uv=[],idx=[],cy=(y0+y1)/2,hw=width/2;
  for(let k=0;k<5;k++){
    const a=k*Math.PI/5,dx=Math.cos(a)*hw,dz=Math.sin(a)*hw,b=pos.length/3;
    const P=[[-dx,y0,-dz,0,0],[dx,y0,dz,1,0],[dx,y1,dz,1,1],[-dx,y1,-dz,0,1]];
    for(const q of P){pos.push(q[0],q[1],q[2]);uv.push(q[3],q[4]);
      // rounded normals (pointing away from the crown centre, biased up) give soft, volume-like lighting
      const n=new THREE.Vector3(q[0]/hw*0.35,1.0+(q[1]-cy)/(y1-y0)*0.4,q[2]/hw*0.35).normalize();nor.push(n.x,n.y,n.z);}
    idx.push(b,b+1,b+2,b,b+2,b+3);
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(nor,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);return g;
}
function texturizeTrees(lib){
  const bark=new THREE.MeshStandardMaterial({map:barkTex,bumpMap:barkTex,bumpScale:1.2,roughness:1});
  const barkUV=pt=>{const P=pt.g.attributes.position,uv=new Float32Array(P.count*2);
    for(let i=0;i<P.count;i++){uv[i*2]=(Math.atan2(P.getZ(i),P.getX(i))/(Math.PI*2)+0.5)*2;uv[i*2+1]=P.getY(i)*0.55;}
    pt.g.setAttribute('uv',new THREE.BufferAttribute(uv,2));pt.m=bark;};
  // conifer: trunk + five crossed cut-out planes
  {const parts=[];for(const pt of lib.Prop_Pine||[]){if(pt.m.name==='P_Bark'){barkUV(pt);parts.push(pt);}}
   const g=crossGeo(5.6,0.9,8.9);sphericalNormals(g,0,4.9,0,1.6);parts.push({g,m:foliageMat(crownTex('pine'))});lib.Prop_Pine=parts;}
  // broadleaf: trunk, branches and twigs with vertical leaf cards hung on them, modelled in Blender (cards carry their own UVs)
  // Prop_OakFar is the same tree with fewer, larger cards for the distant forest belt
  {const mat=foliageMat(leafCardTex());
   for(const name of ['Prop_Oak','Prop_OakFar']){const parts=[];
     for(const pt of lib[name]||[]){
       if(pt.m.name==='P_Bark'){barkUV(pt);parts.push(pt);}
       else if(pt.m.name==='P_Leaf'){sphericalNormals(pt.g,0,3.4,0,0.6);pt.m=mat;parts.push(pt);}
     }
     lib[name]=parts;}}
}

/* ---- building + bridge surfaces: procedural greyscale detail maps multiplied over the model colours ---- */
// box-projected UVs in metres (scale = how much the prop is enlarged in the scene, so details keep real size)
function boxUV(g,tile,scale){
  if(!g.attributes.normal)g.computeVertexNormals();
  const P=g.attributes.position,Nn=g.attributes.normal,uv=new Float32Array(P.count*2),k=(scale||1)/tile;
  for(let i=0;i<P.count;i++){
    const ax=Math.abs(Nn.getX(i)),ay=Math.abs(Nn.getY(i)),az=Math.abs(Nn.getZ(i)),x=P.getX(i),y=P.getY(i),z=P.getZ(i);
    let u,v;if(ay>=ax&&ay>=az){u=x;v=z;}else if(ax>=az){u=z;v=y;}else{u=x;v=y;}
    uv[i*2]=u*k;uv[i*2+1]=v*k;
  }
  g.setAttribute('uv',new THREE.BufferAttribute(uv,2));
}
const BT=(()=>{
  const S=IS_TOUCH?128:256,c8=v=>Math.max(0,Math.min(255,v*255));
  // cast concrete, one 2.4 m formwork panel per tile: board joints, tie holes, mottling and rain streaks
  const n1=fbm(301,4,4),n2=makeNoise(307,64),st=makeNoise(311,48),st2=makeNoise(313,7);
  const concreteFn=(streaks,joints)=>(u,v)=>{
    let g=0.86+(n1(u,v)-0.5)*0.22+(n2(u,v)-0.5)*0.08;
    if(streaks){const streak=Math.pow(st(u,0.5),3)*(0.5+st2(u,v));g-=streak*0.14*(0.4+v*0.6);}
    if(joints){const ju=Math.min(u%0.5,0.5-u%0.5),jv=Math.min(v,1-v,Math.abs(v-0.5));
      if(ju<0.006||jv<0.006)g-=0.09;else if(ju<0.012||jv<0.012)g+=0.03;
      for(const cu of [0.125,0.375,0.625,0.875])for(const cv of [0.25,0.75]){const d=Math.hypot(u-cu,v-cv);if(d<0.012)g-=0.2*(1-d/0.012);}}
    return [c8(g),c8(g),c8(g*0.99)];};
  const concrete=pixelTex(S,S,concreteFn(true,true));       // walls, fascias, piers: rain streaks run down the face
  const concreteFlat=pixelTex(S,S,concreteFn(false,false)); // soffits: plain (joint lines alias at grazing angles)
  // painted cladding: 1 m panels with fine seams and light grime
  const p1=fbm(321,3,3),p2=makeNoise(327,96);
  const paint=pixelTex(S,S,(u,v)=>{
    let g=0.95+(p1(u,v)-0.5)*0.08+(p2(u,v)-0.5)*0.03-Math.pow(st(u,0.3),4)*0.08*(1-v);
    const ju=Math.min(u%0.25,0.25-u%0.25);if(ju<0.004)g-=0.18;else if(ju<0.008)g+=0.03;
    if(Math.min(v,1-v)<0.004)g-=0.12;
    return [c8(g),c8(g),c8(g)];});
  // stadium seats: moulded shells 0.5 m wide (two per tile) with gaps, highlights and wear
  const s1=makeNoise(331,40);
  const seats=pixelTex(S,S,(u,v)=>{
    const x=(u*2)%1,e=Math.abs(x-0.5)*2;
    let g=e>0.86?0.25:0.82+0.18*Math.cos(e*1.6)-0.12*Math.pow(e,6);
    g*=0.92+(s1(u,v)-0.5)*0.16;
    return [c8(g),c8(g),c8(g)];});
  // corrugated metal roof: 0.15 m ribs
  const r1=makeNoise(341,32);
  const roof=pixelTex(S,S,(u,v)=>{const w=Math.sin(u*Math.PI*2*16);let g=0.8+0.16*w+(r1(u,v)-0.5)*0.08-Math.pow(st(u*0.5,v),5)*0.1;return [c8(g),c8(g),c8(g*1.01)];});
  // roller shutters: 0.08 m slats
  const shutter=pixelTex(S,S,(u,v)=>{const y=(v*30)%1;let g=0.62+0.3*Math.sin(y*Math.PI)-(y<0.08?0.25:0)+(r1(u,v)-0.5)*0.06;return [c8(g),c8(g),c8(g*1.02)];});
  // glazing: dark tinted glass with aluminium frames (1.2 m x 1.0 m bays), sky reflection gradient
  const glass=pixelTex(S,S,(u,v)=>{
    const fu=Math.min(u%0.5,0.5-u%0.5),fv=Math.min(v,1-v,Math.abs(v-0.6));
    if(fu<0.018||fv<0.02)return [168,174,182];
    const r=0.16+0.22*Math.max(0,Math.sin((u*1.3+v*0.7)*Math.PI*2))*0.6+v*0.08;
    return [c8(r*0.55),c8(r*0.7),c8(r*0.95)];});
  // painted steel: faint brushing and rust streaks
  const b1=makeNoise(351,128);
  const steel=pixelTex(S,S,(u,v)=>{let g=0.9+(b1(u,v*0.1)-0.5)*0.12-Math.pow(st(u,0.7),6)*0.12*(1-v);return [c8(g),c8(g*0.99),c8(g*0.98)];});
  return {concrete,concreteFlat,paint,seats,roof,shutter,glass,steel};
})();
function texturizeBuildings(lib){
  // per material: [texture, tile size m, bump, extra props]
  const plan={
    P_Concrete:[BT.concrete,2.4,0.4],P_White:[BT.paint,4,0.15],P_SeatBlue:[BT.seats,1,0.5],P_SeatRed:[BT.seats,1,0.5],P_SeatGrey:[BT.seats,1,0.5],
    P_Roof:[BT.roof,2.4,0.8],P_Steel:[BT.steel,3,0.1],P_SteelDark:[BT.shutter,2.4,0.6],P_Blue:[BT.paint,4,0.1],
    P_Glass:[BT.glass,2.4,0,{color:0xffffff,roughness:0.08,metalness:0.55,envMapIntensity:1.6}]};
  for(const name of ['Prop_Grandstand','Prop_PitBuilding']){
    for(const pt of lib[name]||[]){
      const P=plan[pt.m.name];if(!P)continue;
      boxUV(pt.g,P[1],2);   // both buildings are placed at 2x scale
      const m=pt.m.clone();m.map=P[0];if(P[2]){m.bumpMap=P[0];m.bumpScale=P[2];}
      if(pt.m.name==='P_SteelDark')m.color.setHex(0x8a9099);   // shutters read as light grey metal
      if(P[3]){for(const k in P[3]){if(k==='color')m.color.setHex(P[3][k]);else m[k]=P[3][k];}}
      m.needsUpdate=true;pt.m=m;
    }
  }
}
function decorate(){
  if(!PROPS||!trackGroup)return;
  if(decorGroup){scene.remove(decorGroup);decorGroup.traverse(o=>{if(o.isInstancedMesh){o.dispose();o.geometry.index=null;}});}
  decorGroup=new THREE.Group();decorGroup.matrixAutoUpdate=false;scene.add(decorGroup);
  trackGroup.traverse(o=>{if(o.userData.fb)o.visible=false;});
  const def=TR,flat=!def.elev,circuit=!def.guardrail,step=Math.max(1,Math.round(4/SP));
  const hAt=i=>Math.atan2(TX[i],TZ[i]);
  // start gantry spans the road at the line
  instProp('Prop_Gantry',[propMat(PX[0],PY[0],PZ[0],H0,(W+2)/12.6,1,1)],true);
  // grandstands outside the main straight, pit building opposite
  const GS_SCALE=2,gs=[],nMod=circuit?2:1,half=Math.round(20*GS_SCALE/SP);
  for(let k=0;k<nMod;k++){const i=(GSI+(k-(nMod-1)/2)*2*half+N)%N|0,off=WALL+(flat?5:3);
    gs.push(propMat(PX[i]-SX[i]*off,PY[i]-(flat?0:0.2),PZ[i]-SZ[i]*off,hAt(i),GS_SCALE));}
  instProp('Prop_Grandstand',gs,true);
  if(circuit){const i=GSI,off=WALL+18;instProp('Prop_PitBuilding',[propMat(PX[i]+SX[i]*off,PY[i],PZ[i]+SZ[i]*off,hAt(i),GS_SCALE)],true);}
  // barriers: tyre walls in the corners, catch fence along the straights (circuits only)
  if(circuit){
    // walk each barrier line and drop a 4 m module every 4 m of actual wall length (no gaps on the outside of bends)
    const tw=[],fe=[];
    for(const s of [1,-1]){
      const wp=i=>{const off=OF(i,s*WALL);return [PX[i]+SX[i]*off,PY[i],PZ[i]+SZ[i]*off];};
      let prev=wp(0),acc=2.0;
      for(let n=1;n<=N;n++){
        const i=n%N,cur=wp(i),dx=cur[0]-prev[0],dz=cur[2]-prev[2],seg=Math.hypot(dx,dz);
        let t0=0;
        while(acc+seg*(1-t0)>=4){
          const need=4-acc,t=t0+need/seg;acc=0;t0=t;
          const x=prev[0]+dx*t,z=prev[2]+dz*t,y=prev[1]+(cur[1]-prev[1])*t,j=(t<0.5?(n-1+N)%N:i);
          if(bridgeZ&&inBridge(j,30))continue;
          const h=Math.atan2(dx,dz),rot=s>0?h+Math.PI:h;
          if(CORN[j]){if(s===(-KS[j]||1))tw.push(propMat(x,y,z,rot));}else fe.push(propMat(x,y,z,rot));
        }
        acc+=seg*(1-t0);prev=cur;
      }
    }
    instProp('Prop_TireWall',tw,false);instProp('Prop_Fence',fe,false);
  }
  // billboards along straights and marshal posts on the outside of corners
  const bb={Prop_BB_A:[],Prop_BB_B:[],Prop_BB_C:[]},names=Object.keys(bb),mp=[];
  let lastB=-1e9,lastM=-1e9,nb=0;
  for(let i=0;i<N;i++){
    const dist=i*SP;
    if(!CORN[i]&&dist-lastB>(circuit?170:260)&&Math.abs(((i-GSI+N/2)%N)-N/2)>60){
      lastB=dist;const s=(nb%2)?1:-1,off=s*(WALL+(circuit?4.5:3.5)),x=PX[i]+SX[i]*off,z=PZ[i]+SZ[i]*off;
      bb[names[nb%3]].push(propMat(x,flat?0:groundY(x,z),z,s>0?hAt(i)+Math.PI:hAt(i)));nb++;
    }
    if(CORN[i]&&dist-lastM>260){
      lastM=dist;const s=-KS[i]||1,off=s*(WALL+3.2),x=PX[i]+SX[i]*off,z=PZ[i]+SZ[i]*off;
      mp.push(propMat(x,flat?0:groundY(x,z),z,s>0?hAt(i)+Math.PI:hAt(i)));
    }
  }
  names.forEach(n=>instProp(n,bb[n],true));instProp('Prop_Marshal',mp,true);
  // trees (pines on the mountain pass, mixed elsewhere)
  const pines=[],oaks=[],oaksFar=[],R=rng(77);
  for(const t of TREES){const k=t[2]*4.2,m=propMat(t[0],t[3]+0.2,t[1],R()*6.28,k,k*(0.9+R()*0.3),k);(def.guardrail||R()<0.55?pines:((t[4]||LOW)&&PROPS.Prop_OakFar?oaksFar:oaks)).push(m);}
  // mountain pass: trees scattered at random along the roadside, except on the grandstand straight
  if(def.guardrail){
    let a0=GSI,a1=GSI;
    while(!CORN[(a0-1+N)%N]&&GSI-a0<N/2)a0--;
    while(!CORN[(a1+1)%N]&&a1-GSI<N/2)a1++;
    const pad=Math.round(25/SP),inMain=i=>{const d=((i-(a0-pad))%N+N)%N;return d<=(a1-a0+2*pad);};
    let next=0;
    for(let i=0;i<N;i++){
      if(i*SP<next)continue;
      next=i*SP+6+R()*18;
      if(inMain(i))continue;
      // same size range as the other trees; trunks set back far enough that crowns only just reach over the barrier
      const k=(0.7+R()*0.9)*4.2,s2=R()<0.5?1:-1,off=OF(i,s2*(WALL+3+2.8*k*0.55+R()*6)),x=PX[i]+SX[i]*off,z=PZ[i]+SZ[i]*off;
      const m=propMat(x,groundY(x,z),z,R()*6.28,k,k*(0.85+R()*0.3),k);
      (R()<0.85?pines:(LOW&&PROPS.Prop_OakFar?oaksFar:oaks)).push(m);
    }
  }
  // circuit trees all stand 100 m+ from the track, outside the car-centred shadow box, so they skip the shadow pass
  instProp('Prop_Pine',pines,!circuit);instProp('Prop_Oak',oaks,!circuit);instProp('Prop_OakFar',oaksFar,false);
}

/* ================= Track ================= */
// Course definitions. ctrl = control points (x, z) in metres before scale.
// elev = [fraction of lap, height m] keys; bridge = overpass height for a figure-8; hills = terrain relief.
const TRACKS=[
  {key:'gp',name:'グランプリ',label:'GRAND PRIX',scale:1.25,startMid:true,W:10.5,gap:11,runoff:5,
   lead:'起伏のない高速レイアウト。ブレーキングポイントを見極めて、表彰台を目指してください。',
   ctrl:[[0,0],[0,-300],[40,-420],[160,-470],[300,-430],[360,-330],[330,-220],[250,-160],[240,-60],[320,20],[420,60],[470,170],[420,280],[300,320],[180,280],[120,180],[60,120],[0,60]]},
  {key:'tech',name:'ハヤテ・テクニカル',label:'HAYATE TECHNICAL',scale:1.3,startMid:true,W:10.5,gap:10,runoff:5,hills:16,blendFar:140,bridge:9,
   lead:'立体交差のある8の字コース。切り返しの鋭いS字と、立体交差をくぐった先の長い左コーナーが見どころです。',
   ctrl:[[-60,0],[250,0],[350,20],[395,90],[380,165],[320,205],[255,265],[185,220],[120,235],[50,300],[-40,260],[-150,215],[-250,215],[-330,265],[-365,350],[-340,430],[-260,460],[-170,450],[-100,410],[-110,340],[-150,270],[-160,170],[-158,95],[-135,35],[-100,6]],
   elev:[[0,0],[0.1,0],[0.2,3],[0.3,8],[0.38,6],[0.45,1],[0.6,-1],[0.7,3],[0.76,4],[0.83,1],[0.94,2],[1,0]]},
  {key:'touge',name:'イナズマ峠',label:'INAZUMA TOUGE',scale:1.3,W:9.3,gap:4.4,runoff:2,hills:46,blendFar:110,guardrail:true,trees:2.2,
   lead:'山を駆け上がる峠道。高低差は約80m。道幅が狭く、連続ヘアピンでは早めのブレーキが鍵になります。',
   ctrl:[[-150,0],[120,0],[250,-20],[400,-55],[440,-68],[458,-90],[445,-110],[415,-116],[260,-122],[225,-132],[212,-155],[228,-174],[260,-182],[420,-190],[452,-202],[462,-226],[445,-246],[410,-252],[300,-262],[240,-290],[200,-340],[130,-385],[30,-405],[-70,-390],[-140,-350],[-150,-305],[-120,-270],[-130,-235],[-185,-222],[-250,-225],[-280,-210],[-282,-182],[-255,-168],[-180,-160],[-150,-140],[-160,-110],[-220,-95],[-265,-75],[-275,-40],[-250,-10],[-210,0]],
   elev:[[0,0],[0.07,0],[0.16,8],[0.26,20],[0.36,33],[0.46,47],[0.53,62],[0.6,80],[0.66,78],[0.73,62],[0.8,44],[0.87,26],[0.94,8],[1,0]]}
];
let COURSE=0,TR=TRACKS[0];
let N=0,LEN=0,SP=1,PX,PZ,PY,TX,TZ,SX,SZ,K,GR,KS,TB;
// banking: road rises toward the outside of the corner, pivoting on the inside edge
function BY(i,o){const t=TB[i];if(!t)return 0;const u=t>0?o:-o;return (clamp(u,-W,W+TR.runoff)+W)*Math.abs(t);}
// keep offsets on the inside of tight corners from folding over themselves
function OF(i,o){if(o*KS[i]>0){const lim=0.92/Math.max(K[i],1e-4);if(Math.abs(o)>lim)return o>0?lim:-lim;}return o;}
let W=7,WALL=18,cx=0,cz=0,minX=0,maxX=0,minZ=0,maxZ=0,H0=0;
let ROAD_MAT=null,HILL_MAT=null,WEATHER=0,WX_READY=false;   // weather: 0 clear, 1 rain, 2 dusk
let trackGroup=null,terrainH=null,bridgeZ=null,CORN=null,TREES=[],GSI=0,decorGroup=null,PROPS=null;
const sstep=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const cdist=(a,b)=>{const d=Math.abs(a-b);return Math.min(d,N-d)*SP;};
const inBridge=(k,m)=>!!bridgeZ&&cdist(k,bridgeZ.j)<(m||42);
function groundY(x,z){return terrainH?terrainH(x,z):0;}
function keyInterp(keys,f){
  for(let i=0;i<keys.length-1;i++){const a=keys[i],b=keys[i+1];if(f>=a[0]&&f<=b[0]){const t=(f-a[0])/(b[0]-a[0]);return a[1]+(b[1]-a[1])*(0.5-0.5*Math.cos(Math.PI*t));}}
  return keys[keys.length-1][1];
}
function disposeGroup(g){g.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose());});scene.remove(g);}

// ground (flat base plane, shared)
const ground=new THREE.Mesh(new THREE.PlaneGeometry(7000,7000),new THREE.MeshStandardMaterial({map:grassTex,roughness:1,metalness:0}));
ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;ground.matrixAutoUpdate=false;scene.add(ground);
const noiseTex=(()=>{
  const S=TEXQ/2,big=fbm(51,4,3),mid=fbm(57,16,3),R=rng(21);
  const t=pixelTex(S,S,(u,v)=>{const k=0.80+(big(u,v)-0.5)*0.22+(mid(u,v)-0.5)*0.16+(R()-0.5)*0.12;const c=Math.min(255,k*255);return [c,c,c];});
  const g=t.image.getContext('2d');
  for(let i=0;i<S*S/18;i++){const x=R()*S,y=R()*S,l=1.5+R()*3;g.strokeStyle=R()<0.5?'rgba(120,120,120,.35)':'rgba(255,255,255,.30)';g.beginPath();g.moveTo(x,y);g.lineTo(x+(R()-0.5),y-l);g.stroke();}
  t.needsUpdate=true;return t;
})();

function ribbon(o0,o1,y0,y1,vDiv){
  const pos=[],uv=[],nor=[],idx=[];
  for(let i=0;i<=N;i++){const j=i%N,h=PY[j],p0=OF(j,o0),p1=OF(j,o1);
    pos.push(PX[j]+SX[j]*p0,y0+h+BY(j,p0),PZ[j]+SZ[j]*p0, PX[j]+SX[j]*p1,y1+h+BY(j,p1),PZ[j]+SZ[j]*p1);
    uv.push(0,i*SP/vDiv,1,i*SP/vDiv);nor.push(0,1,0,0,1,0);
    if(i<N){const a=i*2;idx.push(a,a+2,a+1,a+1,a+2,a+3);}
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  g.setAttribute('normal',new THREE.Float32BufferAttribute(nor,3));
  g.setIndex(idx);return g;
}
// make the triangle winding face up whichever side "S" points to
function fixWinding(g){g.computeVertexNormals();const n=g.attributes.normal;if(n.getY(0)<0){const ix=g.index.array;for(let i=0;i<ix.length;i+=3){const t=ix[i+1];ix[i+1]=ix[i+2];ix[i+2]=t;}g.index.needsUpdate=true;g.computeVertexNormals();}return g;}
// curbs & barriers (per-segment quads, vertex colours)
function quadStrip(build){
  const pos=[],col=[];
  build((ax,ay,az,bx,by,bz,cx2,cy,cz2,dx,dy,dz,c)=>{
    pos.push(ax,ay,az,bx,by,bz,cx2,cy,cz2, bx,by,bz,dx,dy,dz,cx2,cy,cz2);
    for(let k=0;k<6;k++)col.push(c.r,c.g,c.b);
  });
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));
  g.computeVertexNormals();return g;
}
const cRed=new THREE.Color(0xc8322f),cWhite=new THREE.Color(0xf0f0f0),cConc=new THREE.Color(0xc9cdd2),cTire=new THREE.Color(0x26282c),
      cRail=new THREE.Color(0xb7bec6),cRailDk=new THREE.Color(0x7d858e),cEarth=new THREE.Color(0x6e5c47),cGrassV=new THREE.Color(0x5a8540),cDeck=new THREE.Color(0xa9aeb4);

function buildTrack(ci){
  COURSE=ci;TR=TRACKS[ci];const def=TR;
  if(trackGroup)disposeGroup(trackGroup);
  trackGroup=new THREE.Group();scene.add(trackGroup);
  const add=o=>{trackGroup.add(o);return o;};
  terrainH=null;bridgeZ=null;

  /* --- centre line --- */
  const curve=new THREE.CatmullRomCurve3(def.ctrl.map(p=>new THREE.Vector3(p[0]*def.scale,0,p[1]*def.scale)),true,'centripetal');
  LEN=curve.getLength();N=Math.round(LEN/2.45);SP=LEN/N;
  PX=new Float32Array(N);PZ=new Float32Array(N);PY=new Float32Array(N);TX=new Float32Array(N);TZ=new Float32Array(N);
  SX=new Float32Array(N);SZ=new Float32Array(N);K=new Float32Array(N);GR=new Float32Array(N);
  const pts=curve.getSpacedPoints(N);
  for(let i=0;i<N;i++){PX[i]=pts[i].x;PZ[i]=pts[i].z;}
  for(let i=0;i<N;i++){const a=(i-1+N)%N,b=(i+1)%N;let tx=PX[b]-PX[a],tz=PZ[b]-PZ[a];const l=Math.hypot(tx,tz);TX[i]=tx/l;TZ[i]=tz/l;SX[i]=-TZ[i];SZ[i]=TX[i];}
  const K0=new Float32Array(N);
  for(let i=0;i<N;i++){const a=(i-5+N)%N,b=(i+5)%N;K0[i]=Math.abs(wrapA(Math.atan2(TX[b],TZ[b])-Math.atan2(TX[a],TZ[a])))/(10*SP);}
  for(let i=0;i<N;i++){let s=0;for(let k=-6;k<=6;k++)s+=K0[(i+k+N)%N];K[i]=s/13;}
  KS=new Float32Array(N);
  for(let i=0;i<N;i++){const a=(i-8+N)%N,b=(i+8)%N;KS[i]=Math.sign((TX[b]-TX[a])*SX[i]+(TZ[b]-TZ[a])*SZ[i]);}
  W=def.W;WALL=W+def.gap;
  minX=1e9;maxX=-1e9;minZ=1e9;maxZ=-1e9;
  for(let i=0;i<N;i++){minX=Math.min(minX,PX[i]);maxX=Math.max(maxX,PX[i]);minZ=Math.min(minZ,PZ[i]);maxZ=Math.max(maxZ,PZ[i]);}
  cx=(minX+maxX)/2;cz=(minZ+maxZ)/2;
  H0=Math.atan2(TX[0],TZ[0]);

  /* --- elevation --- */
  if(def.elev)for(let i=0;i<N;i++)PY[i]=keyInterp(def.elev,i/N);
  if(def.bridge){
    // find where the line crosses itself; the later pass goes over the top
    let bi=-1,bj=-1;
    const crs=(ax,az,bx,bz,cx2,cz2)=>(cz2-az)*(bx-ax)-(bz-az)*(cx2-ax);
    outer:for(let i=0;i<N;i++){const i2=(i+1)%N;
      for(let j=i+40;j<N;j++){if(N-(j-i)<40)break;const j2=(j+1)%N;
        if(Math.abs(PX[i]-PX[j])>12||Math.abs(PZ[i]-PZ[j])>12)continue;
        const d1=crs(PX[j],PZ[j],PX[j2],PZ[j2],PX[i],PZ[i]),d2=crs(PX[j],PZ[j],PX[j2],PZ[j2],PX[i2],PZ[i2]);
        const d3=crs(PX[i],PZ[i],PX[i2],PZ[i2],PX[j],PZ[j]),d4=crs(PX[i],PZ[i],PX[i2],PZ[i2],PX[j2],PZ[j2]);
        if((d1>0)!==(d2>0)&&(d3>0)!==(d4>0)){bi=i;bj=j;break outer;}
      }}
    if(bi>=0){
      bridgeZ={i:bi,j:bj};
      for(let k=0;k<N;k++){
        const m=Math.min(sstep(60,200,cdist(k,bi)),sstep(60,200,cdist(k,bj)));
        PY[k]=PY[k]*m+def.bridge*(1-sstep(45,230,cdist(k,bj)));
      }
    }
  }
  TB=new Float32Array(N);
  if(def.bank){
    const [f0,f1,deg]=def.bank,tb=Math.tan(deg*Math.PI/180),i0=Math.floor(f0*N),i1=Math.floor(f1*N);
    let side=0;for(let i=i0;i<=i1;i++)side+=KS[i%N];
    // outward direction in +S terms is -KS; store the sign in TB
    const sg=side>0?-1:1,ramp=Math.round(60/SP);
    for(let i=i0;i<=i1;i++){const w=Math.min(1,(i-i0)/ramp,(i1-i)/ramp);TB[i%N]=sg*tb*(0.5-0.5*Math.cos(Math.PI*clamp(w,0,1)));}
  }
  if(def.startMid){
    // move the start/finish line to the middle of the main straight
    const th=1/350;let a=10,b=10;
    while(K[(a-1+N)%N]<th&&a>-N/2)a--;
    while(K[(b+1)%N]<th&&b<N/2)b++;
    const off=((Math.round((a+b)/2))%N+N)%N;
    if(off){
      for(const arr of [PX,PZ,PY,TX,TZ,SX,SZ,K,KS,TB]){const cp=arr.slice();for(let i=0;i<N;i++)arr[i]=cp[(i+off)%N];}
      if(bridgeZ){bridgeZ.i=(bridgeZ.i-off+N)%N;bridgeZ.j=(bridgeZ.j-off+N)%N;}
    }
  }
  H0=Math.atan2(TX[0],TZ[0]);
  for(let i=0;i<N;i++){const a=(i-1+N)%N,b=(i+1)%N;GR[i]=(PY[b]-PY[a])/(2*SP);}
  const flat=!def.elev;

  /* --- terrain --- */
  if(!flat){
    const pad=480,x0=minX-pad,x1=maxX+pad,z0=minZ-pad,z1=maxZ+pad;
    const G=IS_TOUCH?190:250,cs=Math.max(x1-x0,z1-z0)/G;
    const nx=Math.ceil((x1-x0)/cs),nz=Math.ceil((z1-z0)/cs);
    const sx=[],sz=[],sy=[];
    for(let i=0;i<N;i+=2){if(inBridge(i,46))continue;sx.push(PX[i]);sz.push(PZ[i]);sy.push(PY[i]);}
    // least-squares plane through the road heights, so the hillside leans the same way the road climbs
    let A=[[0,0,0],[0,0,0],[0,0,0]],B=[0,0,0];
    for(let k=0;k<sx.length;k++){const v=[1,sx[k]-cx,sz[k]-cz];for(let r=0;r<3;r++){B[r]+=v[r]*sy[k];for(let c=0;c<3;c++)A[r][c]+=v[r]*v[c];}}
    const det3=m=>m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1])-m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0])+m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);
    const D=det3(A),pl=[0,1,2].map(c=>det3(A.map((row,r)=>row.map((v,cc)=>cc===c?B[r]:v)))/D);
    const ns=(x,z)=>0.5*Math.sin(x*0.0061+1.3)*Math.cos(z*0.0053+0.4)+0.3*Math.sin(x*0.013+z*0.009+2)+0.18*Math.sin(x*0.027-z*0.031+5)+0.08*Math.sin(x*0.061+z*0.047);
    const amp=def.hills,bias=def.guardrail?amp*0.35:amp*0.2;
    const HG=new Float32Array((nx+1)*(nz+1));
    const S=sx.length,SXa=Float32Array.from(sx),SZa=Float32Array.from(sz),SYa=Float32Array.from(sy);
    for(let gz=0;gz<=nz;gz++)for(let gx=0;gx<=nx;gx++){
      const x=x0+gx*cs,z=z0+gz*cs;
      let md=1e18;
      for(let k=0;k<S;k++){const dx=x-SXa[k],dz=z-SZa[k],d2=dx*dx+dz*dz;if(d2<md)md=d2;}
      const d=Math.sqrt(md),bt=sstep(WALL+3,WALL+def.blendFar,d);
      const far=pl[0]+pl[1]*(x-cx)+pl[2]*(z-cz)+ns(x,z)*amp+bias;
      let h=far;
      if(bt<1){
        let sw=0,sh=0;
        for(let k=0;k<S;k++){const dx=x-SXa[k],dz=z-SZa[k],q=dx*dx+dz*dz+16,w=1/(q*q);sw+=w;sh+=w*SYa[k];}
        const near=sh/sw-1.0;h=near+(far-near)*bt;
      }
      const e=sstep(0,170,Math.min(gx*cs,(nx-gx)*cs,gz*cs,(nz-gz)*cs));
      HG[gz*(nx+1)+gx]=h*e-1.2*(1-e);
    }
    terrainH=(x,z)=>{
      const fx=clamp((x-x0)/cs,0,nx-0.001),fz=clamp((z-z0)/cs,0,nz-0.001),ix=fx|0,iz=fz|0,tx=fx-ix,tz=fz-iz,r=nx+1;
      const a=HG[iz*r+ix],b=HG[iz*r+ix+1],c=HG[(iz+1)*r+ix],d=HG[(iz+1)*r+ix+1];
      return a+(b-a)*tx+(c-a)*tz+(a-b-c+d)*tx*tz;
    };
    const pos=new Float32Array((nx+1)*(nz+1)*3),uv=new Float32Array((nx+1)*(nz+1)*2),idx=[];
    for(let gz=0;gz<=nz;gz++)for(let gx=0;gx<=nx;gx++){const v=gz*(nx+1)+gx;pos[v*3]=x0+gx*cs;pos[v*3+1]=HG[v];pos[v*3+2]=z0+gz*cs;uv[v*2]=gx*cs/14;uv[v*2+1]=gz*cs/14;}
    for(let gz=0;gz<nz;gz++)for(let gx=0;gx<nx;gx++){const a=gz*(nx+1)+gx,b=a+1,c=a+nx+1,d=c+1;idx.push(a,c,b,b,c,d);}
    const tg=new THREE.BufferGeometry();
    tg.setAttribute('position',new THREE.BufferAttribute(pos,3));tg.setAttribute('uv',new THREE.BufferAttribute(uv,2));
    tg.setIndex(idx);tg.computeVertexNormals();
    const nrm=tg.attributes.normal,col=new Float32Array(pos.length),cG=new THREE.Color(),cR=new THREE.Color(0x8a8378),cD=new THREE.Color(0x3f6a33);
    for(let v=0;v<nrm.count;v++){
      const ny=nrm.getY(v),hgt=pos[v*3+1];
      cG.copy(cGrassV).lerp(cD,clamp(hgt/90,0,0.6));
      cG.lerp(cR,sstep(0.86,0.66,ny));
      col[v*3]=cG.r;col[v*3+1]=cG.g;col[v*3+2]=cG.b;
    }
    tg.setAttribute('color',new THREE.BufferAttribute(col,3));
    const terr=add(new THREE.Mesh(tg,new THREE.MeshStandardMaterial({map:noiseTex,vertexColors:true,roughness:1,metalness:0})));
    terr.receiveShadow=true;
    ground.position.set(cx,-1.2,cz);ground.updateMatrix();
  }else{
    ground.position.set(cx,0,cz);ground.updateMatrix();
  }

  /* --- road, shoulders, run-off --- */
  const road=add(new THREE.Mesh(fixWinding(ribbon(-W,W,0.03,0.03,12)),new THREE.MeshStandardMaterial({map:asphaltTex,bumpMap:asphaltTex,bumpScale:0.6,roughness:0.86,metalness:0.0,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2})));
  road.receiveShadow=true;ROAD_MAT=road.material;
  const runoffMat=new THREE.MeshStandardMaterial({map:gravelTex,bumpMap:gravelTex,bumpScale:0.8,color:def.guardrail?0xd8d2c4:0xffffff,roughness:1,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
  const ro=def.runoff,GE=WALL+0.4-W;   // GE: green grass verge from the road edge to the fence (circuits)
  if(!def.guardrail&&!flat){   // hilly circuit only: on the flat circuit the grass ground plane already shows through, seamlessly
    const gt=grassTex.clone();gt.needsUpdate=true;gt.wrapS=gt.wrapT=THREE.RepeatWrapping;gt.repeat.set(GE/16.7,1);gt.anisotropy=8;
    const vergeMat=new THREE.MeshStandardMaterial({map:gt,roughness:1,metalness:0,polygonOffset:true,polygonOffsetFactor:-1.5,polygonOffsetUnits:-1.5});
    [[W,W+GE],[-W-GE,-W]].forEach(([a,b])=>{
      const g=ribbon(a,b,0.02,0.02,16.7);
      if(bridgeZ){const ix=[];for(let i=0;i<N;i++){if(inBridge(i)||inBridge((i+1)%N))continue;const q=i*2;ix.push(q,q+2,q+1,q+1,q+2,q+3);}g.setIndex(ix);}
      const m=add(new THREE.Mesh(fixWinding(g),vergeMat));m.receiveShadow=true;});
  }
  if(def.guardrail){
    [[W,W+ro],[-W-ro,-W]].forEach(([a,b])=>{const m=add(new THREE.Mesh(fixWinding(ribbon(a,b,0.015,0.015,8)),runoffMat));m.receiveShadow=true;});
  }
  if(!flat){
    // grass shoulder out past the barrier (concrete deck on the bridge), with an earth skirt that hides the terrain seam
    const E=WALL+2;
    const sh=quadStrip(push=>{
      for(let i=0;i<N;i++){const j=(i+1)%N,br=inBridge(i)||inBridge(j),c=br?cDeck:cGrassV;
        if(br)continue;   // the bridge deck is built separately below, with concrete textures
        for(const s of [1,-1]){
          const pts2=[[s*W,s*E]];
          for(const [o0,o1] of pts2){
            const a=[PX[i]+SX[i]*OF(i,o0),PY[i]-0.005+BY(i,OF(i,o0)),PZ[i]+SZ[i]*OF(i,o0)],b=[PX[j]+SX[j]*OF(j,o0),PY[j]-0.005+BY(j,OF(j,o0)),PZ[j]+SZ[j]*OF(j,o0)],
                  c2=[PX[i]+SX[i]*OF(i,o1),PY[i]-0.005+BY(i,OF(i,o1)),PZ[i]+SZ[i]*OF(i,o1)],d=[PX[j]+SX[j]*OF(j,o1),PY[j]-0.005+BY(j,OF(j,o1)),PZ[j]+SZ[j]*OF(j,o1)];
            if(s>0)push(...a,...c2,...b,...d,c);else push(...a,...b,...c2,...d,c);
          }
          // skirt / bridge fascia
          const o=s*E,cc=br?cDeck:cEarth,bi=BY(i,OF(i,o)),bj=BY(j,OF(j,o)),drop=br?1.4:7+Math.max(bi,bj);
          const ta=[PX[i]+SX[i]*OF(i,o),PY[i]-0.005+bi,PZ[i]+SZ[i]*OF(i,o)],tb=[PX[j]+SX[j]*OF(j,o),PY[j]-0.005+bj,PZ[j]+SZ[j]*OF(j,o)];
          push(...ta,...tb,ta[0],ta[1]-drop,ta[2],tb[0],tb[1]-drop,tb[2],cc);
        }
      }
    });
    const shm=add(new THREE.Mesh(sh,new THREE.MeshStandardMaterial({vertexColors:true,map:noiseTex,roughness:1,side:THREE.DoubleSide})));
    shm.receiveShadow=true;shm.castShadow=true;
    if(bridgeZ){
      // ---- overpass: textured concrete deck edge, fascia, soffit, and round piers with a cap beam ----
      const pos=[],uv=[],pos2=[],uv2=[],T=2.4;
      const q4=(P,U,a,b,c,d,ua,ub,uc,ud)=>{P.push(...a,...b,...c,...b,...d,...c);U.push(...ua,...ub,...uc,...ub,...ud,...uc);};
      const at=(k,o,dy)=>[PX[k]+SX[k]*OF(k,o),PY[k]-0.005+BY(k,OF(k,o))+(dy||0),PZ[k]+SZ[k]*OF(k,o)];
      for(let i=0;i<N;i++){const j=(i+1)%N;if(!(inBridge(i)||inBridge(j)))continue;
        const ui=i*SP/T,uj=(i+1)*SP/T;
        for(const s of [1,-1]){
          // walkway / edge beam on top, out to the barrier line
          const a=at(i,s*W),b=at(j,s*W),c=at(i,s*E),d=at(j,s*E),oa=(E-W)/T;
          if(s>0)q4(pos,uv,a,c,b,d,[ui,0],[ui,oa],[uj,0],[uj,oa]);else q4(pos,uv,a,b,c,d,[ui,0],[uj,0],[ui,oa],[uj,oa]);
          // outer fascia, 1.4 m deep
          const ta=at(i,s*E),tb=at(j,s*E),ba=at(i,s*E,-1.4),bb=at(j,s*E,-1.4),h=1.4/T;
          q4(pos,uv,ta,tb,ba,bb,[ui,h],[uj,h],[ui,0],[uj,0]);
        }
        // soffit (underside), darker
        const A=[PX[i]+SX[i]*E,PY[i]-1.4,PZ[i]+SZ[i]*E],B=[PX[j]+SX[j]*E,PY[j]-1.4,PZ[j]+SZ[j]*E],C=[PX[i]-SX[i]*E,PY[i]-1.4,PZ[i]-SZ[i]*E],D=[PX[j]-SX[j]*E,PY[j]-1.4,PZ[j]-SZ[j]*E],w2=2*E/T;
        q4(pos2,uv2,A,B,C,D,[ui,0],[uj,0],[ui,w2],[uj,w2]);
      }
      const mk=(P,U,col,tex)=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(P,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(U,2));g.computeVertexNormals();
        const m=add(new THREE.Mesh(g,new THREE.MeshStandardMaterial({map:tex,bumpMap:tex,bumpScale:0.35,color:col,roughness:0.92,side:THREE.DoubleSide})));m.receiveShadow=true;m.castShadow=true;return m;};
      mk(pos,uv,0xc6cacd,BT.concrete);mk(pos2,uv2,0x8f949a,BT.concreteFlat);
      const pm=new THREE.MeshStandardMaterial({map:BT.concrete,bumpMap:BT.concrete,bumpScale:0.35,color:0xb9bdc1,roughness:0.9});
      const lo=bridgeZ.i,jj=bridgeZ.j;
      for(const s of [1,-1]){
        // walk along the upper road until clear of the lower road's barrier, then build a pier bent
        for(let k=0;k<60;k++){const q=(jj+s*k+N)%N;const dx=PX[q]-PX[lo],dz=PZ[q]-PZ[lo],lat=Math.abs(dx*SX[lo]+dz*SZ[lo]);
          if(lat>WALL+3){
            const top=PY[q]-1.4,base=Math.min(groundY(PX[q],PZ[q]),PY[lo])-1.5,hgt=top-1.1-base;
            const bent=new THREE.Group();bent.position.set(PX[q],0,PZ[q]);bent.rotation.y=Math.atan2(TX[q],TZ[q]);
            for(const t of [1,-1]){const cg=new THREE.CylinderGeometry(0.85,0.95,hgt,20);boxUV(cg,2.4,1);
              const col=new THREE.Mesh(cg,pm);col.position.set(t*(W-1.5),base+hgt/2,0);col.castShadow=true;col.receiveShadow=true;bent.add(col);}
            const capG=new THREE.BoxGeometry(2*(W-1.5)+3,1.1,2.2);boxUV(capG,2.4,1);
            const cap=new THREE.Mesh(capG,pm);cap.position.set(0,top-0.55,0);cap.castShadow=true;cap.receiveShadow=true;bent.add(cap);
            add(bent);break;}
        }
      }
    }
  }

  /* --- curbs --- */
  const curbGeo=quadStrip(push=>{
    for(let i=0;i<N;i++){
      if(K[i]<1/320&&K[(i+6)%N]<1/320&&K[(i-6+N)%N]<1/320)continue;
      const j=(i+1)%N,c=((i>>1)&1)?cRed:cWhite;
      for(const s of [1,-1]){
        const o0=s*W,o1=s*(W+1.4);
        const A=[PX[i]+SX[i]*o0,0.04+PY[i]+BY(i,o0),PZ[i]+SZ[i]*o0],B=[PX[j]+SX[j]*o0,0.04+PY[j]+BY(j,o0),PZ[j]+SZ[j]*o0],C=[PX[i]+SX[i]*o1,0.09+PY[i]+BY(i,o1),PZ[i]+SZ[i]*o1],D=[PX[j]+SX[j]*o1,0.09+PY[j]+BY(j,o1),PZ[j]+SZ[j]*o1];
        push(...A,...B,...C,...D,c);
      }
    }
  });
  const curbs=add(new THREE.Mesh(curbGeo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.7,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-3,polygonOffsetUnits:-3})));
  curbs.receiveShadow=true;

  /* --- barriers: tyre/concrete walls on the circuits, steel guardrail on the pass --- */
  CORN=new Uint8Array(N);for(let i=0;i<N;i++)CORN[i]=K[i]>1/260?1:0;
  // mode false: straights + inside of corners; mode true: outside of corners (replaced by tyre walls when props load)
  const wallPart=wantCorner=>quadStrip(push=>{
    for(let i=0;i<N;i++){
      const j=(i+1)%N,corner=CORN[i]===1;
      for(const s of [1,-1]){
        const outerC=!def.guardrail&&corner&&s===(-KS[i]||1);
        if(outerC!==wantCorner)continue;
        const o=s*WALL;
        const oi=OF(i,o),oj=OF(j,o),ax=PX[i]+SX[i]*oi,az=PZ[i]+SZ[i]*oi,bx=PX[j]+SX[j]*oj,bz=PZ[j]+SZ[j]*oj,ya=PY[i]+BY(i,oi),yb=PY[j]+BY(j,oj);
        if(def.guardrail){
          push(ax,ya+0.45,az,bx,yb+0.45,bz,ax,ya+0.85,az,bx,yb+0.85,bz,(i%10<5)?cRail:cRailDk);
          if(i%4===0){const px=PX[i]+SX[i]*(oi+s*0.15),pz=PZ[i]+SZ[i]*(oi+s*0.15),tx=TX[i]*0.09,tz=TZ[i]*0.09;
            push(px-tx,ya,pz-tz,px+tx,ya,pz+tz,px-tx,ya+0.8,pz-tz,px+tx,ya+0.8,pz+tz,cRailDk);}
        }else{
          const c=corner?(((i>>1)&1)?cRed:cWhite):((i%8===0)?cTire:cConc);
          push(ax,ya,az,bx,yb,bz,ax,ya+1.05,az,bx,yb+1.05,bz,c);
        }
      }
    }
  });
  const wallMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:def.guardrail?0.4:0.85,metalness:def.guardrail?0.6:0,side:THREE.DoubleSide});
  const walls=add(new THREE.Mesh(wallPart(false),wallMat));
  walls.receiveShadow=true;walls.castShadow=true;
  if(!def.guardrail){const cw=add(new THREE.Mesh(wallPart(true),wallMat));cw.receiveShadow=true;cw.castShadow=true;cw.userData.fb=1;}

  /* --- start line + gantry --- */
  {
    const g=add(new THREE.Group());g.position.set(PX[0],PY[0],PZ[0]);g.rotation.y=H0;
    const line=new THREE.Mesh(new THREE.PlaneGeometry(W*2,1.8),new THREE.MeshStandardMaterial({map:checkerTex,roughness:.8,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4}));
    line.rotation.x=-Math.PI/2;line.position.y=0.04;line.receiveShadow=true;g.add(line);
    const steel=new THREE.MeshStandardMaterial({color:0x2b3038,metalness:.6,roughness:.45});
    for(const s of [1,-1]){const p=new THREE.Mesh(new THREE.BoxGeometry(0.6,7.4,0.6),steel);p.position.set(s*(W+2),3.7,0);p.castShadow=true;p.userData.fb=1;g.add(p);}
    const beam=new THREE.Mesh(new THREE.BoxGeometry(W*2+4.6,1.4,0.8),steel);beam.position.set(0,7.2,0);beam.castShadow=true;beam.userData.fb=1;g.add(beam);
    const board=new THREE.Mesh(new THREE.PlaneGeometry(W*2,0.9),new THREE.MeshStandardMaterial({map:checkerTex,emissive:0x222222}));
    board.position.set(0,7.2,-0.42);board.rotation.y=Math.PI;board.userData.fb=1;g.add(board);
  }
  /* --- grandstand on the outside of the main straight --- */
  const gsi=N-36;GSI=gsi;
  {
    const ci2=gsi,h=Math.atan2(TX[ci2],TZ[ci2]),off=WALL+(flat?5:3);
    const g=add(new THREE.Group());g.position.set(PX[ci2]-SX[ci2]*off,PY[ci2]-(flat?0:0.2),PZ[ci2]-SZ[ci2]*off);g.rotation.y=h;g.userData.fb=1;
    const conc=new THREE.MeshStandardMaterial({color:0xb4b9bf,roughness:.9});
    const seats=new THREE.MeshStandardMaterial({map:crowdTex,roughness:.9});
    const rows=def.guardrail?5:10,len=def.guardrail?44:80;
    for(let r=0;r<rows;r++){
      const m=new THREE.Mesh(new THREE.BoxGeometry(2.2,1.2*(r+1)+4,len),[conc,conc,seats,conc,conc,conc]);
      m.position.set(r*2.2+1.1,0.6*(r+1)-2,0);m.castShadow=true;m.receiveShadow=true;g.add(m);
    }
    const roof=new THREE.Mesh(new THREE.BoxGeometry(rows*2.2+4,0.5,len+2),new THREE.MeshStandardMaterial({color:0xe6e9ec,roughness:.6,metalness:.2}));
    roof.position.set(rows*1.1,rows*1.2+4.2,0);roof.rotation.z=-0.08;roof.castShadow=true;g.add(roof);
    for(let k=-3;k<=3;k++){const p=new THREE.Mesh(new THREE.BoxGeometry(0.5,rows*1.2+4,0.5),conc);p.position.set(rows*2.2,(rows*1.2+4)/2,k*len/7);g.add(p);}
  }
  /* --- trees --- */
  {
    const nearTrack=(x,z,d)=>{const d2=d*d;for(let i=0;i<N;i+=3){const dx=x-PX[i],dz=z-PZ[i];if(dx*dx+dz*dz<d2)return true;}return false;};
    const gsx=PX[gsi]-SX[gsi]*(WALL+30),gsz=PZ[gsi]-SZ[gsi]*(WALL+30),pbx=PX[gsi]+SX[gsi]*(WALL+40),pbz=PZ[gsi]+SZ[gsi]*(WALL+40);
    const want=Math.round((IS_TOUCH?220:320)*(def.trees||1)*(LOW?0.3:1));
    const spots=[];let tries=0;
    if(!def.guardrail){
      // circuits: open grass out to 500 m, then a forest belt 500-600 m from the track
      const D0=500,D1=600,st=LOW?(IS_TOUCH?44:40):(IS_TOUCH?21:17);
      const near2=(x,z,d)=>{const d2=d*d;for(let i=0;i<N;i+=2){const dx=x-PX[i],dz=z-PZ[i];if(dx*dx+dz*dz<d2)return true;}return false;};
      // even-odd test against the centre line: nothing grows in the infield (both loops of the figure 8)
      const inside=(x,z)=>{let c=false;for(let i=0,j=N-1;i<N;j=i++){if((PZ[i]>z)!==(PZ[j]>z)&&x<(PX[j]-PX[i])*(z-PZ[i])/(PZ[j]-PZ[i])+PX[i])c=!c;}return c;};
      for(let x=minX-D1;x<=maxX+D1;x+=st)for(let z=minZ-D1;z<=maxZ+D1;z+=st){
        const px=x+(Math.random()-0.5)*st*0.8,pz=z+(Math.random()-0.5)*st*0.8;
        if(near2(px,pz,D0)||!near2(px,pz,D1)||inside(px,pz))continue;
        spots.push([px,pz,0.7+Math.random()*0.9,groundY(px,pz)-0.2,1]);   // [4]=1: seen only from 100 m+, use the light broadleaf
      }
      tries=want*14;   // skip the scattered placement below
    }
    while(spots.length<want&&tries<want*14){tries++;
      const x=minX-260+Math.random()*(maxX-minX+520),z=minZ-260+Math.random()*(maxZ-minZ+520);
      if(nearTrack(x,z,WALL+(flat?22:18)))continue;   // room for full-size trees
      if(Math.hypot(x-gsx,z-gsz)<190||Math.hypot(x-pbx,z-pbz)<110)continue;
      const y=groundY(x,z);
      if(!flat){const sl=Math.abs(groundY(x+3,z)-y)+Math.abs(groundY(x,z+3)-y);if(sl>2.6)continue;}
      spots.push([x,z,0.7+Math.random()*0.9,y-0.2]);
    }
    TREES=spots;
    const trunkG=new THREE.CylinderGeometry(0.25,0.4,2.6,6);trunkG.translate(0,1.3,0);
    const leafG=new THREE.ConeGeometry(2.3,6.5,8);leafG.translate(0,5.4,0);
    const trunks=add(new THREE.InstancedMesh(trunkG,new THREE.MeshStandardMaterial({color:0x5a4130,roughness:1}),spots.length));
    const leaves=add(new THREE.InstancedMesh(leafG,new THREE.MeshStandardMaterial({color:0xffffff,roughness:.95}),spots.length));
    const m=new THREE.Matrix4(),q=new THREE.Quaternion(),s=new THREE.Vector3(),p=new THREE.Vector3(),col=new THREE.Color();
    spots.forEach((t,i)=>{p.set(t[0],t[3],t[1]);q.setFromAxisAngle(new THREE.Vector3(0,1,0),Math.random()*6);s.set(t[2],t[2]*(0.85+Math.random()*0.4),t[2]);m.compose(p,q,s);trunks.setMatrixAt(i,m);leaves.setMatrixAt(i,m);
      col.setHSL(0.26+Math.random()*0.07,0.38+Math.random()*0.15,(def.guardrail?0.17:0.22)+Math.random()*0.1);leaves.setColorAt(i,col);});
    leaves.castShadow=true;trunks.castShadow=true;trunks.userData.fb=1;leaves.userData.fb=1;
  }
  /* --- distant hills --- */
  {
    const seg=160,R0=1700,R1=1600,pos=[],idx=[],lift=def.guardrail?110:(def.hills?30:0);
    for(let i=0;i<=seg;i++){const a=i/seg*Math.PI*2;
      const hgt=90+lift+(70+lift*0.5)*Math.sin(a*3.1)+45*Math.sin(a*7.3+1)+25*Math.sin(a*13.7+2);
      pos.push(cx+Math.cos(a)*R0,-5,cz+Math.sin(a)*R0, cx+Math.cos(a)*R1,hgt,cz+Math.sin(a)*R1);
      if(i<seg){const b=i*2;idx.push(b,b+1,b+2,b+1,b+3,b+2);}
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setIndex(idx);g.computeVertexNormals();
    HILL_MAT=add(new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:def.guardrail?0x7f9aae:0x8ea8bd,fog:false,side:THREE.DoubleSide}))).material;HILL_MAT.userData.base=HILL_MAT.color.getHex();
  }
  trackGroup.traverse(o=>{o.updateMatrix();o.matrixAutoUpdate=false;});trackGroup.updateMatrixWorld(true);
  decorate();
  if(WX_READY)applyWeather(WEATHER);
  $('trackInfo').textContent=def.label+' · '+(LEN/1000).toFixed(2)+' km · 5 CARS';
  $('menuLead').textContent='CPU 4台との周回レース。あなたは最後尾グリッドからのスタートです。'+def.lead;
}
buildTrack(0);

/* ================= Cars ================= */
function profileGeo(pts,depth,bevel){
  const s=new THREE.Shape();pts.forEach((p,i)=>i?s.lineTo(p[0],p[1]):s.moveTo(p[0],p[1]));
  const g=new THREE.ExtrudeGeometry(s,{depth,bevelEnabled:true,bevelThickness:bevel,bevelSize:bevel,bevelSegments:2,steps:1,curveSegments:4});
  g.translate(0,0,-depth/2);g.rotateY(-Math.PI/2);return g;
}
const BODY_PTS=[[-2.25,0.32],[2.12,0.32],[2.3,0.46],[2.22,0.6],[1.4,0.79],[0.6,0.86],[0.0,1.22],[-1.05,1.25],[-1.85,0.98],[-2.3,0.92]];
const GLASS_PTS=[[0.68,0.85],[0.03,1.24],[-1.0,1.27],[-1.72,0.99],[-1.55,0.85]];
const bodyGeo=profileGeo(BODY_PTS,1.82,0.06);
const glassGeo=profileGeo(GLASS_PTS,1.88,0.05);
const wheelGeo=new THREE.CylinderGeometry(0.36,0.36,0.32,18);wheelGeo.rotateZ(Math.PI/2);
const rimGeo=new THREE.CylinderGeometry(0.22,0.22,0.34,10);rimGeo.rotateZ(Math.PI/2);
const matTrim=new THREE.MeshStandardMaterial({color:0x16181c,roughness:.6,metalness:.3});
const matGlass=new THREE.MeshStandardMaterial({color:0x0c141d,roughness:.08,metalness:.9,envMapIntensity:1.4});
const matTire=new THREE.MeshStandardMaterial({color:0x121212,roughness:.92});
const matRim=new THREE.MeshStandardMaterial({color:0xb9c0c8,roughness:.3,metalness:.85});
const matHead=new THREE.MeshStandardMaterial({color:0xffffff,emissive:0xfff3d6,emissiveIntensity:.9});

function makeCar(color){
  const g=new THREE.Group();g.rotation.order='YXZ';
  const body=new THREE.Mesh(bodyGeo,new THREE.MeshStandardMaterial({color,metalness:.55,roughness:.3,envMapIntensity:1.1}));
  body.castShadow=true;g.add(body);
  const glass=new THREE.Mesh(glassGeo,matGlass);g.add(glass);
  const split=new THREE.Mesh(new THREE.BoxGeometry(1.95,0.07,0.4),matTrim);split.position.set(0,0.3,2.12);g.add(split);
  const diff=new THREE.Mesh(new THREE.BoxGeometry(1.8,0.22,0.15),matTrim);diff.position.set(0,0.42,-2.3);g.add(diff);
  const wing=new THREE.Mesh(new THREE.BoxGeometry(1.95,0.06,0.42),matTrim);wing.position.set(0,1.16,-2.02);wing.castShadow=true;g.add(wing);
  for(const s of [1,-1]){const p=new THREE.Mesh(new THREE.BoxGeometry(0.06,0.24,0.2),matTrim);p.position.set(s*0.62,1.02,-2.0);g.add(p);
    const hl=new THREE.Mesh(new THREE.BoxGeometry(0.46,0.1,0.06),matHead);hl.position.set(s*0.6,0.58,2.27);hl.rotation.x=-0.5;g.add(hl);}
  const tailMat=new THREE.MeshStandardMaterial({color:0x5a0b0b,emissive:0xff1a1a,emissiveIntensity:.35});
  for(const s of [1,-1]){const t=new THREE.Mesh(new THREE.BoxGeometry(0.52,0.09,0.05),tailMat);t.position.set(s*0.6,0.8,-2.34);g.add(t);}
  const wheels=[],pivots=[];
  [[0.93,1.42,true],[-0.93,1.42,true],[0.93,-1.38,false],[-0.93,-1.38,false]].forEach(([x,z,front])=>{
    const holder=new THREE.Group();holder.position.set(x,0.36,z);g.add(holder);
    const w=new THREE.Group();holder.add(w);
    const tire=new THREE.Mesh(wheelGeo,matTire);tire.castShadow=true;w.add(tire);
    const rim=new THREE.Mesh(rimGeo,matRim);w.add(rim);
    const spoke=new THREE.Mesh(new THREE.BoxGeometry(0.35,0.06,0.42),matRim);w.add(spoke);
    wheels.push(w);if(front)pivots.push(holder);
  });
  scene.add(g);
  return {group:g,wheels,pivots,tailMat};
}

const CAR_DEFS=[
  {name:'VELOCE',color:0x1f56c8,stripe:0xf2f2f2},
  {name:'KUROGANE',color:0x2a2d33,stripe:0xc8202a},
  {name:'ORBIT',color:0xe9ecef,stripe:0x1f56c8},
  {name:'VERDE',color:0x1b7d4f,stripe:0xf2d23c},
  {name:'YOU',color:0xb5121b,player:true}
];
const cars=CAR_DEFS.map(d=>{
  const v=makeCar(d.color);
  return Object.assign({name:d.name,hex:'#'+d.color.toString(16).padStart(6,'0'),isPlayer:!!d.player,
    x:0,y:0,z:0,h:0,pitch:0,vx:0,vz:0,steer:0,steerIn:0,throttle:0,brake:0,hb:false,idx:0,lap:0,lat:0,slip:0,
    skill:1,eng:1,laneOff:0,laneBase:0,finished:false,finishT:0,lapStart:0,lastLap:0,bestLap:Infinity,spin:0},v);
});
const player=cars[cars.length-1];
if(LOW){
  const cv=document.createElement('canvas');cv.width=cv.height=64;
  const g2=cv.getContext('2d'),gr=g2.createRadialGradient(32,32,6,32,32,32);
  gr.addColorStop(0,'rgba(0,0,0,0.55)');gr.addColorStop(1,'rgba(0,0,0,0)');g2.fillStyle=gr;g2.fillRect(0,0,64,64);
  const bm=new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(cv),transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
  const bg=new THREE.PlaneGeometry(2.8,6.0);bg.rotateX(-Math.PI/2);
  for(const c of cars){const s=new THREE.Mesh(bg,bm);s.position.y=0.05;s.renderOrder=1;s.userData.keep=1;c.group.add(s);}
}

/* ================= Blender car model (APEX GT) ================= */
const CAR_SCALE=1.5;
const WHEEL_R=0.34*CAR_SCALE;
// Performance: bake every non-moving, opaque part of the car into one mesh per material.
// Same geometry, same materials, same transforms - just far fewer draw calls. Wheels and see-through parts stay separate.
function mergeStatic(root){
  root.updateMatrixWorld(true);
  const inv=new THREE.Matrix4().copy(root.matrixWorld).invert();
  const underWheel=o=>{for(let p=o;p&&p!==root;p=p.parent)if(/^Wheel_/.test(p.name))return true;return false;};
  const groups=new Map();
  root.traverse(o=>{
    if(!o.isMesh||Array.isArray(o.material)||underWheel(o))return;
    const m=o.material;if(m.transparent||m.opacity<1||m.alphaTest>0)return;
    const g=o.geometry;if(!g.attributes.position||g.morphAttributes&&Object.keys(g.morphAttributes).length)return;
    const key=m.uuid+'|'+Object.keys(g.attributes).sort().join(',')+'|'+(g.index?1:0);
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(o);
  });
  const M=new THREE.Matrix4(),NM=new THREE.Matrix3(),GET=['getX','getY','getZ','getW'];
  groups.forEach(list=>{
    if(list.length<2)return;
    const names=Object.keys(list[0].geometry.attributes);
    let vtot=0,itot=0;
    for(const o of list){vtot+=o.geometry.attributes.position.count;itot+=o.geometry.index?o.geometry.index.count:o.geometry.attributes.position.count;}
    const out={};names.forEach(n=>{const a=list[0].geometry.attributes[n];out[n]=new Float32Array(vtot*a.itemSize);});
    const idx=vtot>65535?new Uint32Array(itot):new Uint16Array(itot);
    let vo=0,io=0;
    for(const o of list){
      const g=o.geometry;M.multiplyMatrices(inv,o.matrixWorld);NM.getNormalMatrix(M);
      const flip=M.determinant()<0,cnt=g.attributes.position.count;
      const v=new THREE.Vector3();
      for(const n of names){
        const a=g.attributes[n],dst=out[n],is=a.itemSize;
        for(let i=0;i<cnt;i++){
          if(n==='position'){v.fromBufferAttribute(a,i).applyMatrix4(M);dst[(vo+i)*3]=v.x;dst[(vo+i)*3+1]=v.y;dst[(vo+i)*3+2]=v.z;}
          else if(n==='normal'){v.fromBufferAttribute(a,i).applyMatrix3(NM).normalize();dst[(vo+i)*3]=v.x;dst[(vo+i)*3+1]=v.y;dst[(vo+i)*3+2]=v.z;}
          else{for(let k=0;k<is;k++)dst[(vo+i)*is+k]=a[GET[k]](i);}
        }
      }
      const src=g.index?g.index.array:null,n2=src?src.length:cnt;
      for(let i=0;i<n2;i+=3){
        const a=src?src[i]:i,b=src?src[i+1]:i+1,c=src?src[i+2]:i+2;
        idx[io++]=vo+a;if(flip){idx[io++]=vo+c;idx[io++]=vo+b;}else{idx[io++]=vo+b;idx[io++]=vo+c;}
      }
      vo+=cnt;
    }
    const mg=new THREE.BufferGeometry();
    names.forEach(n=>mg.setAttribute(n,new THREE.BufferAttribute(out[n],list[0].geometry.attributes[n].itemSize,list[0].geometry.attributes[n].normalized)));
    mg.setIndex(new THREE.BufferAttribute(idx,1));mg.computeBoundingSphere();mg.computeBoundingBox();
    const mesh=new THREE.Mesh(mg,list[0].material);mesh.name='Merged_'+(list[0].material.name||'mat');
    mesh.castShadow=list.some(o=>o.castShadow);mesh.receiveShadow=list.some(o=>o.receiveShadow);
    root.add(mesh);
    for(const o of list){o.parent.remove(o);}
  });
}
const _tyreLowCache=new Map();
function tyreLow(g){
  if(_tyreLowCache.has(g))return _tyreLowCache.get(g);
  g.computeBoundingBox();const b=g.boundingBox,w=b.max.x-b.min.x,R=Math.max(b.max.y-b.min.y,b.max.z-b.min.z)/2,cx=(b.max.x+b.min.x)/2,ri=R*0.72;
  const prof=[[ri,-w/2],[R*0.93,-w/2],[R,-w*0.36],[R,w*0.36],[R*0.93,w/2],[ri,w/2]].map(p=>new THREE.Vector2(p[0],p[1]));
  const lg=new THREE.LatheGeometry(prof,24);lg.rotateZ(-Math.PI/2);lg.translate(cx,(b.max.y+b.min.y)/2,(b.max.z+b.min.z)/2);
  _tyreLowCache.set(g,lg);return lg;
}
function prepCarSource(src){
  // the scene renders without sRGB output, so bring the model's linear colours into display space
  const seen=new Set();
  src.traverse(o=>{if(o.isMesh&&!seen.has(o.material)){seen.add(o.material);o.material.color.convertLinearToSRGB();if(o.material.emissive)o.material.emissive.convertLinearToSRGB();}});
  // carbon parts: woven texture with box-projected UVs (the model ships without UVs to stay small)
  src.traverse(o=>{
    if(!o.isMesh||!o.material||o.material.name!=='WingCarbon'||o.geometry.attributes.uv)return;
    const g=o.geometry,P=g.attributes.position;if(!g.attributes.normal)g.computeVertexNormals();
    const Nn=g.attributes.normal,uv=new Float32Array(P.count*2),S=22;
    for(let i=0;i<P.count;i++){
      const ax=Math.abs(Nn.getX(i)),ay=Math.abs(Nn.getY(i)),az=Math.abs(Nn.getZ(i));
      let u,v;if(ax>=ay&&ax>=az){u=P.getZ(i);v=P.getY(i);}else if(ay>=az){u=P.getX(i);v=P.getZ(i);}else{u=P.getX(i);v=P.getY(i);}
      uv[i*2]=u*S;uv[i*2+1]=v*S;
    }
    g.setAttribute('uv',new THREE.BufferAttribute(uv,2));
    if(!o.material.map){o.material.map=carbonTex;o.material.color.setRGB(1,1,1);o.material.needsUpdate=true;}
  });
  mergeStatic(src);
}
function applyModel(gltf){
  const src=gltf.scene;
  prepCarSource(src);
  cars.forEach((c,ci)=>{
    const wrap=new THREE.Group();wrap.rotation.y=Math.PI;wrap.scale.setScalar(CAR_SCALE);wrap.position.y=0.03;
    const m=src.clone(true);wrap.add(m);
    let tail=null;
    m.traverse(o=>{
      if(!o.isMesh)return;
      const mn=o.material&&o.material.name;
      if(mn==='CarPaint'){
        o.material=o.material.clone();
        if(!c.isPlayer)o.material.color.setHex(CAR_DEFS[ci].color);
        o.castShadow=true;
      }else if(mn==='Tire'){o.castShadow=true;}
      else if(mn==='TailLED'){if(!tail)tail=o.material.clone();o.material=tail;}
      else if(mn==='Stripe'){o.material=o.material.clone();if(!c.isPlayer)o.material.color.setHex(CAR_DEFS[ci].stripe);}
      else if(mn==='TailLens'){o.material=o.material.clone();o.material.emissiveIntensity=0.25;}
      else if(mn==='RainLight'){RAIN_MATS.add(o.material);}
      if(mn==='Glass'||mn==='Chrome'||mn==='CarPaint')o.material.envMapIntensity=1.2;
    });
    const wheels=[];
    ['Wheel_FL','Wheel_FR','Wheel_RL','Wheel_RR'].forEach(n=>{
      const w=m.getObjectByName(n);if(!w)return;
      wheels.push({node:w,q0:w.quaternion.clone(),front:n.charAt(6)==='F',sgn:Math.abs(w.quaternion.y)>0.5?1:-1,a:0});
    });
    const wheelSet=new Set(wheels.map(w=>w.node));
    wrap.updateMatrix();wrap.matrixAutoUpdate=false;
    m.traverse(o=>{if(!wheelSet.has(o)){o.updateMatrix();o.matrixAutoUpdate=false;}});
    const simple=c.group.children.filter(ch=>!ch.userData.keep);   // procedural body: kept hidden, reused as the LOW far LOD
    simple.forEach(ch=>{ch.visible=false;});
    c.group.add(wrap);
    // headlight glows (shown in rain and at dusk)
    {if(!HEAD.z){const bb=new THREE.Box3().setFromObject(src);HEAD.z=-bb.min.z*CAR_SCALE-0.05;HEAD.x=bb.max.x*CAR_SCALE*0.66;HEAD.y=(bb.min.y+(bb.max.y-bb.min.y)*0.36)*CAR_SCALE+0.03;}
     for(const sx of [1,-1]){const sp=new THREE.Sprite(glowMat);sp.position.set(sx*HEAD.x,HEAD.y,HEAD.z);sp.scale.set(1.5,1.5,1);sp.visible=WX[WEATHER].lights>0;sp.renderOrder=6;c.group.add(sp);GLOWS.push(sp);}}
    // distance LOD: small interior / lamp / brake parts are hidden on cars more than ~32 m from the camera
    const fine=[],FINE=/^(InteriorShell|DashSoft|SeatFabric|SeatAccent|InteriorAlu|Screen|FloorMat|GrilleHex|ProjLens|LampHousing|BrakeDisc|Caliper|ExhaustInner|LED|TailInner)$/;
    m.traverse(o=>{if(o.isMesh&&o.material&&FINE.test(o.material.name))fine.push(o);});
    // tyres swap to a 24-sided version at distance
    const tyres=[];m.traverse(o=>{if(o.isMesh&&o.material&&o.material.name==='Tire'){tyres.push([o,o.geometry,tyreLow(o.geometry)]);}});
    c.model={wheels,tail:tail||c.tailMat,fine,tyres,near:true,wrap,simple,lodFar:false,lv:0,lod:null};
  });
  loadCarLod();
}
// LOW: a reduced-polygon APEX GT (models/apex_lod1.glb, ~32k instead of ~140k triangles, interior removed)
// for CPU cars between ~15 m and 500 m. It shares the full model's materials, so paint, stripes and brake
// lights match exactly. If the file is not there (e.g. the single-file build) the full model is kept.
function loadCarLod(){
  if(!LOW||!THREE.GLTFLoader)return;
  fetch('models/apex_lod1.glb').then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.arrayBuffer();})
    .then(buf=>new THREE.GLTFLoader().parse(buf,'',applyCarLod,()=>{})).catch(()=>{});
}
function applyCarLod(gltf){
  const src=gltf.scene;prepCarSource(src);
  for(const c of cars){
    if(c.isPlayer||!c.model)continue;
    const mats={};c.model.wrap.traverse(o=>{if(o.isMesh&&o.material&&o.material.name)mats[o.material.name]=o.material;});
    const wrap=new THREE.Group();wrap.rotation.y=Math.PI;wrap.scale.setScalar(CAR_SCALE);wrap.position.y=0.03;
    const m=src.clone(true);wrap.add(m);
    m.traverse(o=>{if(o.isMesh&&o.material&&mats[o.material.name])o.material=mats[o.material.name];});
    const wheels=[];
    ['Wheel_FL','Wheel_FR','Wheel_RL','Wheel_RR'].forEach(n=>{
      const w=m.getObjectByName(n);if(!w)return;
      wheels.push({node:w,q0:w.quaternion.clone(),front:n.charAt(6)==='F',sgn:Math.abs(w.quaternion.y)>0.5?1:-1,a:0});
    });
    const wheelSet=new Set(wheels.map(w=>w.node));
    wrap.updateMatrix();wrap.matrixAutoUpdate=false;
    m.traverse(o=>{if(!wheelSet.has(o)){o.updateMatrix();o.matrixAutoUpdate=false;}});
    wrap.visible=false;c.group.add(wrap);
    for(const w of wheels)c.model.wheels.push(w);   // spun together with the full model's wheels
    c.model.lod=wrap;c.model.lv=-1;                  // force a level pick on the next frame
  }
}
const _qS=new THREE.Quaternion(),_qX=new THREE.Quaternion(),_Y=new THREE.Vector3(0,1,0),_X=new THREE.Vector3(1,0,0);
function setModelStatus(t,ok){const e=document.getElementById('modelStatus');if(e){e.textContent=t;e.dataset.ok=ok?'1':'0';}}
(function loadModel(){
  if(!THREE.GLTFLoader){setModelStatus('車体モデル：読み込めませんでした（簡易マシンで走行します）',false);return;}
  setModelStatus('車体モデル：読み込み中…',false);
  const fail=e=>{setModelStatus('車体モデル：読み込みに失敗しました（簡易マシンで走行します）',false);console.error(e);};
  fetch('models/apex.glb').then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.arrayBuffer();}).then(buf=>{
    new THREE.GLTFLoader().parse(buf,'',g=>{applyModel(g);setModelStatus('車体モデル：APEX GT（GTウイング・角型バンパー・ハニカムグリル・丸型4灯テール・ディテールアップ）読み込み完了',true);},fail);
  }).catch(fail);
})();

(function loadProps(){
  if(!THREE.GLTFLoader)return;
  fetch('models/props.glb').then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.arrayBuffer();}).then(buf=>{
    new THREE.GLTFLoader().parse(buf,'',g=>{PROPS=buildPropLib(g.scene);texturizeTrees(PROPS);texturizeBuildings(PROPS);decorate();},e=>console.error(e));
  }).catch(e=>console.error(e));
})();

/* ================= Race state ================= */
let LAPS=3,DIFF=1,state='menu',raceT=0,cdT=0,camMode=0,camH=0,orbitA=0,resultTimer=-1,wrongT=0;
const finishOrder=[];
const SKILL=[0.88,0.96,1.02];

function bestKey(){return 'apexcircuit-best-'+DIFF+(COURSE?'-c'+COURSE:'');}
function loadBest(){try{const v=localStorage.getItem(bestKey());return v?parseFloat(v):Infinity;}catch(e){return Infinity;}}
function saveBest(v){try{localStorage.setItem(bestKey(),String(v));}catch(e){}}
function updateBestNote(){const b=loadBest();$('bestNote').innerHTML=isFinite(b)?'この難易度の自己ベストラップ <b>'+fmt(b)+'</b>':'ベストラップはこの端末に記録されます。';}

function fmt(t){if(!isFinite(t))return '--:--.---';const m=Math.floor(t/60),s=t-m*60;return m+':'+(s<10?'0':'')+s.toFixed(3);}

function nearestIdx(x,z,hint){
  if(hint!=null){let b=hint,bd=1e18;for(let k=-160;k<=160;k++){const i=(hint+k+N)%N,dx=x-PX[i],dz=z-PZ[i],d=dx*dx+dz*dz;if(d<bd){bd=d;b=i;}}if(bd<1600)return b;}
  let b=0,bd=1e18;for(let i=0;i<N;i++){const dx=x-PX[i],dz=z-PZ[i],d=dx*dx+dz*dz;if(d<bd){bd=d;b=i;}}return b;}

function placeGrid(){
  if(typeof smokeClear==='function')smokeClear();
  finishOrder.length=0;
  cars.forEach((c,k)=>{
    const i=(N-8-k*5)%N;const side=(k%2?-1:1)*4.5;
    c.x=PX[i]+SX[i]*side;c.z=PZ[i]+SZ[i]*side;c.y=PY[i]+BY(i,side);c.pitch=0;c.h=Math.atan2(TX[i],TZ[i]);
    c.vx=c.vz=0;c.steer=c.steerIn=0;c.throttle=c.brake=0;c.hb=false;
    c.idx=i;c.lap=0;c.lat=side;c.finished=false;c.finishT=0;c.lapStart=0;c.lastLap=0;c.bestLap=Infinity;c.slip=0;c.laps=[];c.spin=0;c.lastYaw=0;c.rl=0;c.beta=0;c.thrAvg=0;c.liftArmed=false;c.slideT=0;
    c.laneBase=side*0.25;c.laneOff=side;
    if(!c.isPlayer){c.skill=SKILL[DIFF]+[0.025,0.012,-0.004,-0.02][k];c.eng=clamp(0.9+0.1*c.skill,0.9,1.012);}
    else{c.skill=1;c.eng=1;}
  });
  camH=player.h;
}

/* ================= Physics ================= */
const GRIP=18;
// wet track: less lateral grip, longer braking and a little less traction (rain only)
const WET={grip:0.7,brake:0.72,trac:0.85,spinAng:21*Math.PI/180,spinSpd:80/3.6,spinHold:2.0};
const wet=()=>WEATHER===1;
function stepCar(c,dt){
  const sh=Math.sin(c.h),ch=Math.cos(c.h);
  const fx=sh,fz=ch,rx=-ch,rz=sh;
  let vf=c.vx*fx+c.vz*fz,vl=c.vx*rx+c.vz*rz;
  const off=Math.abs(c.lat)>W+1.0;
  c.steer+=(c.steerIn-c.steer)*Math.min(1,dt*(c.isPlayer?6.5:5));
  // longitudinal
  let a=0;
  const W1=wet();
  if(c.throttle>0)a+=c.throttle*Math.max(0,14-Math.max(vf,0)*0.14)*c.eng*(off?0.5:1)*(W1?WET.trac:1);
  if(c.brake>0){if(vf>0.5)a-=c.brake*26*(W1?WET.brake:1);else if(vf>-11)a-=c.brake*7;}
  a-=9.8*GR[c.idx]*(fx*TX[c.idx]+fz*TZ[c.idx]);
  const sgn=vf>0?1:vf<0?-1:0;
  a-=sgn*(0.35+0.00045*vf*vf+(off?2+Math.abs(vf)*0.07:0)+(c.hb?4:0));
  const nvf=vf+a*dt;
  vf=(c.throttle===0&&c.brake===0&&nvf*vf<0)?0:nvf;
  // lateral grip
  let grip=off?10:GRIP+9.8*Math.abs(TB[c.idx])*1.8;if(c.hb)grip*=0.42;if(W1)grip*=WET.grip;
  // ---- wet-track oversteer (player only, rain only) ----
  // A: snapping the throttle shut mid-corner (lift-off: weight moves forward, the rear goes light) or
  //    flooring it while still turning (power-over: the driven rear wheels spin up) makes the rear let go.
  //    c.rl (0..1) is how far the rear has lost grip; it adds rotation toward the inside of the turn.
  // B: steering against the rotation (countersteer) lets the rear regain grip and the car straightens up;
  //    the car only spins if the body slip angle keeps growing past the limit.
  let rlYaw=0,counter=false;
  if(c.isPlayer){
    if(c.spin>0){grip*=0.18;c.rl=0;}
    else if(W1&&!off&&vf>8){
      const st=Math.abs(c.steer);
      c.thrAvg=(c.thrAvg||0)+((c.throttle||0)-(c.thrAvg||0))*Math.min(1,dt*4);
      if(c.throttle>0.5)c.liftArmed=true;
      // A-1 lift-off
      if(c.liftArmed&&c.throttle<0.15&&c.thrAvg>0.55&&st>0.18&&vf>15){
        c.liftArmed=false;c.rl=Math.max(c.rl||0,clamp(0.35+st*0.8,0,1)*clamp((vf-12)/18,0.4,1));c.rlDir=Math.sign(c.steer);}
      // A-2 power-over
      if(c.throttle>0.85&&st>0.32&&vf<34){c.rl=Math.min(1,(c.rl||0)+dt*2.4*(st-0.3)*c.throttle);c.rlDir=Math.sign(c.steer);}
      // B: countersteer = steering that turns the nose back toward the direction of travel
      const rot=-Math.sign(vl);   // direction the body is rotating relative to its path
      counter=Math.abs(vl)>0.6&&Math.sign(c.steer)===-rot&&st>0.12;
      c.rl=Math.max(0,(c.rl||0)-dt*(counter?3.2+st*3:1.1));
      if(c.rl>0){grip*=1-0.42*c.rl;rlYaw=(c.rlDir||1)*c.rl*1.9;}
      // spin: body slip angle of 21 deg or more at 80 km/h or more, held for 2 seconds
      const beta=Math.atan2(Math.abs(vl),Math.abs(vf));c.beta=beta;
      if(beta>=WET.spinAng&&Math.hypot(vf,vl)>=WET.spinSpd)c.slideT=(c.slideT||0)+dt;else c.slideT=0;
      if(c.slideT>=WET.spinHold){
        c.spin=1;c.spinRot=0;c.rl=0;c.slideT=0;c.spinDir=Math.sign(c.lastYaw||-vl)||1;flash('スピン！');}
    }else{c.rl=0;c.beta=0;c.slideT=0;}
  }
  const mc=grip*dt;vl+=clamp(-vl,-mc,mc);
  c.slip=Math.abs(vl);
  vf-=Math.sign(vf)*Math.min(Math.abs(vf),c.slip*0.22*dt);
  // yaw
  const maxSt=0.6/(1+Math.abs(vf)*0.048);
  let yaw=vf*Math.tan(c.steer*maxSt)/2.6;
  const ym=(grip*1.15+(c.hb?9:0))/Math.max(Math.abs(vf),4);
  yaw=clamp(yaw,-ym,ym);
  if(rlYaw)yaw+=rlYaw;   // rear stepping out (wet oversteer)
  if(c.spin>0){
    // swap ends: fast rotation that eases off as the nose comes round to face backwards
    const left=Math.PI-c.spinRot,w=Math.max(1.2,Math.min(4.2,left*3.2));
    yaw=c.spinDir*w;c.spinRot+=w*dt;
    if(c.spinRot>=Math.PI*0.97){c.spin=0;}
  }
  c.lastYaw=yaw;
  c.h-=yaw*dt;
  c.vx=fx*vf+rx*vl;c.vz=fz*vf+rz*vl;
  c.x+=c.vx*dt;c.z+=c.vz*dt;
  c.vf=vf;
}
function trackUpdate(c){
  let best=c.idx,bd=1e18;
  for(let k=-20;k<=45;k++){const j=(c.idx+k+N)%N,dx=c.x-PX[j],dz=c.z-PZ[j],d=dx*dx+dz*dz;if(d<bd){bd=d;best=j;}}
  if(bd>900){best=nearestIdx(c.x,c.z,c.idx);}
  const prev=c.idx;
  if(prev>N*0.8&&best<N*0.2)onLap(c,1);
  else if(prev<N*0.2&&best>N*0.8)c.lap--;
  c.idx=best;
  const sx=SX[best],sz=SZ[best];
  c.lat=(c.x-PX[best])*sx+(c.z-PZ[best])*sz;
  {const f=(c.x-PX[best])*TX[best]+(c.z-PZ[best])*TZ[best],nb=f>=0?(best+1)%N:(best-1+N)%N;c.y=PY[best]+Math.abs(f)/SP*(PY[nb]-PY[best])+BY(best,c.lat);}
  const wl=Math.abs(OF(best,c.lat>0?WALL:-WALL))-1.6;
  if(Math.abs(c.lat)>wl){
    const sg=Math.sign(c.lat),push=c.lat-sg*wl;
    c.x-=sx*push;c.z-=sz*push;c.lat-=push;
    const vs=c.vx*sx+c.vz*sz;
    if(vs*sg>0){c.vx-=sx*vs*1.35;c.vz-=sz*vs*1.35;if(c.isPlayer&&Math.abs(vs)>6)thud(Math.abs(vs));}
    c.vx*=0.994;c.vz*=0.994;
  }
}
function onLap(c,d){
  c.lap+=d;
  if(c.lap===1){c.lapStart=raceT;return;}
  if(c.lap>=2){
    const lt=raceT-c.lapStart;c.lapStart=raceT;c.lastLap=lt;(c.laps||(c.laps=[])).push(lt);
    const wasBest=lt<c.bestLap;if(wasBest)c.bestLap=lt;
    if(c.isPlayer&&!c.finished){
      if(c.lap<=LAPS){
        if(c.lap===LAPS)flash('ファイナルラップ');
        else if(wasBest&&c.lap>2)flash('ベストラップ '+fmt(lt));
        else flash('LAP '+c.lap+' / '+LAPS);
      }
      const stored=loadBest();if(lt<stored)saveBest(lt);
    }
  }
  if(c.lap>LAPS&&!c.finished){
    c.finished=true;c.finishT=raceT;finishOrder.push(c);
    if(c.isPlayer){state='finished';resultTimer=3.2;flash(finishOrder.length+'位 フィニッシュ！');}
  }
}
function collide(){
  for(let i=0;i<cars.length;i++)for(let j=i+1;j<cars.length;j++){
    const a=cars[i],b=cars[j];if(Math.abs(a.y-b.y)>3)continue;let dx=b.x-a.x,dz=b.z-a.z;const d=Math.hypot(dx,dz),R=5.2;
    if(d<R&&d>0.001){
      dx/=d;dz/=d;const pen=(R-d)/2;a.x-=dx*pen;a.z-=dz*pen;b.x+=dx*pen;b.z+=dz*pen;
      const rv=(b.vx-a.vx)*dx+(b.vz-a.vz)*dz;
      if(rv<0){const imp=-rv*0.6;a.vx-=dx*imp;a.vz-=dz*imp;b.vx+=dx*imp;b.vz+=dz*imp;if((a.isPlayer||b.isPlayer)&&-rv>3)thud(-rv*1.5);}
    }
  }
}
function progress(c){return c.lap*N+c.idx;}

/* ================= CPU driver ================= */
function cpuDrive(c){
  const v=Math.max(0,c.vx*Math.sin(c.h)+c.vz*Math.cos(c.h));
  // traffic avoidance: pick a lane away from the car just ahead
  let laneT=c.laneBase;
  const fx=Math.sin(c.h),fz=Math.cos(c.h);
  for(const o of cars){if(o===c)continue;
    const dx=o.x-c.x,dz=o.z-c.z,ahead=dx*fx+dz*fz;
    if(ahead>0&&ahead<16+v*0.25){const side=Math.abs(c.lat-o.lat);if(side<4.8){laneT=o.lat>0?o.lat-5.6:o.lat+5.6;}}
  }
  laneT=clamp(laneT,-W+2.4,W-2.4);
  c.laneOff+=(laneT-c.laneOff)*0.04;
  const la=Math.round((7+v*0.5)/SP),j=(c.idx+la)%N;
  const tx=PX[j]+SX[j]*c.laneOff,tz=PZ[j]+SZ[j]*c.laneOff;
  const diff=wrapA(Math.atan2(tx-c.x,tz-c.z)-c.h);
  c.steerIn=clamp(-diff*2.8,-1,1);
  // speed planning from curvature ahead
  let skill=c.skill;
  if(!c.isPlayer){const gap=(progress(c)-progress(player))/N;skill*=1-clamp(gap*0.12,-0.04,0.05);}
  const aLat=16.5*Math.min(skill,1.04)*(wet()?WET.grip*0.97:1),dec=20*(wet()?WET.brake:1);
  let target=90;
  for(let k=0;k<110;k+=3){const jj=(c.idx+k)%N,kk=Math.max(K[jj],1e-5);const lim=Math.sqrt((aLat+9.8*Math.abs(TB[jj])*1.8*(wet()?WET.grip:1))/kk);const reach=Math.sqrt(lim*lim+2*dec*k*SP);if(reach<target)target=reach;}
  target*=0.985+0.03*(skill-1);
  if(c.isPlayer)target=Math.min(target,45);
  c.throttle=v<target?clamp((target-v)*0.4+0.25,0,1):0;
  c.brake=v>target+1.2?clamp((v-target)*0.3,0,1):0;
  c.hb=false;
  // recover if stuck facing wrong way
  const dot=fx*TX[c.idx]+fz*TZ[c.idx];
  if(dot<-0.2&&v<6){c.throttle=0;c.brake=1;c.steerIn=c.steerIn>0?-1:1;}
}

/* ================= Input ================= */
const keys={up:false,down:false,left:false,right:false,hb:false};
const touch={thr:0,steer:0,brake:false};
// PC mouse: right button = accelerator, left button = brake (on the 3D view)
const mouse={thr:false,brake:false};
$('stage').addEventListener('mousedown',e=>{if(e.button===2)mouse.thr=true;else if(e.button===0)mouse.brake=true;e.preventDefault();});
addEventListener('mouseup',e=>{if(e.button===2)mouse.thr=false;else if(e.button===0)mouse.brake=false;});
addEventListener('contextmenu',e=>{if(state==='race'||state==='countdown'||state==='finished'||e.target.closest('#stage'))e.preventDefault();});
const KM={ArrowUp:'up',KeyW:'up',ArrowDown:'down',KeyS:'down',ArrowLeft:'left',KeyA:'left',ArrowRight:'right',KeyD:'right',Space:'hb'};
addEventListener('keydown',e=>{
  if(KM[e.code]){keys[KM[e.code]]=true;e.preventDefault();}
  if(e.repeat)return;
  if(e.code==='KeyC')toggleCam();
  if(e.code==='KeyR')resetPlayer();
  if(e.code==='Escape'||e.code==='KeyP')togglePause();
});
addEventListener('keyup',e=>{if(KM[e.code]){keys[KM[e.code]]=false;e.preventDefault();}});
addEventListener('blur',()=>{for(const k in keys)keys[k]=false;touch.thr=0;touch.steer=0;touch.brake=false;mouse.thr=mouse.brake=false;});
(function(){
  const wp=$('wheelPad'),wg=$('wheelG'),bb=$('brakeBtn'),tp=$('thrPad'),fill=tp.querySelector('.fill'),knob=tp.querySelector('.knob'),pct=tp.querySelector('.pct');
  const cap=(el,e)=>{try{el.setPointerCapture(e.pointerId);}catch(_){}};
  // steering: horizontal drag from where the finger landed, analog -1..1, springs back on release
  let wId=null,wX=0;
  const setSteer=v=>{touch.steer=v;wg.setAttribute('transform','rotate('+(v*135).toFixed(1)+')');};
  wp.addEventListener('pointerdown',e=>{e.preventDefault();wId=e.pointerId;wX=e.clientX;cap(wp,e);setSteer(0);});
  wp.addEventListener('pointermove',e=>{if(e.pointerId!==wId)return;const r=wp.getBoundingClientRect().width*0.42;setSteer(clamp((e.clientX-wX)/r,-1,1));});
  const wEnd=e=>{if(e.pointerId!==wId)return;wId=null;setSteer(0);};
  ['pointerup','pointercancel','lostpointercapture'].forEach(t=>wp.addEventListener(t,wEnd));
  // throttle: finger height inside the lever = pedal travel, analog 0..1, releases to 0
  let tId=null;
  const setThr=v=>{touch.thr=v;const p=(v*100).toFixed(0)+'%';fill.style.height=p;knob.style.bottom=p;pct.textContent=Math.round(v*100)+'%';};
  const thrAt=e=>{const r=tp.getBoundingClientRect();setThr(clamp((r.bottom-e.clientY-8)/(r.height-40),0,1));};
  tp.addEventListener('pointerdown',e=>{e.preventDefault();tId=e.pointerId;cap(tp,e);thrAt(e);});
  tp.addEventListener('pointermove',e=>{if(e.pointerId===tId)thrAt(e);});
  const tEnd=e=>{if(e.pointerId!==tId)return;tId=null;setThr(0);};
  ['pointerup','pointercancel','lostpointercapture'].forEach(t=>tp.addEventListener(t,tEnd));
  // brake
  const bOn=e=>{e.preventDefault();touch.brake=true;bb.classList.add('on');cap(bb,e);},bOff=()=>{touch.brake=false;bb.classList.remove('on');};
  bb.addEventListener('pointerdown',bOn);['pointerup','pointercancel','lostpointercapture'].forEach(t=>bb.addEventListener(t,bOff));
  [wp,bb,tp].forEach(el=>el.addEventListener('contextmenu',e=>e.preventDefault()));
})();
function playerInput(){
  const c=player;
  if(c.finished){cpuDrive(c);return;}
  c.throttle=Math.max((keys.up||mouse.thr)?1:0,touch.thr);
  c.brake=(keys.down||touch.brake||mouse.brake)?1:0;
  const ks=(keys.right?1:0)-(keys.left?1:0);
  c.steerIn=ks||touch.steer;
  c.hb=keys.hb;
}
let resetCool=0;
function resetPlayer(){
  if(!(state==='race')||resetCool>0)return;resetCool=1.5;
  const c=player,i=nearestIdx(c.x,c.z,c.idx);
  c.x=PX[i]+SX[i]*clamp(c.lat,-W+2,W-2);c.z=PZ[i]+SZ[i]*clamp(c.lat,-W+2,W-2);c.h=Math.atan2(TX[i],TZ[i]);c.vx=c.vz=0;c.steer=0;c.idx=i;c.y=PY[i];c.spin=0;
  camH=c.h;flash('コースに復帰');
}
function toggleCam(){camMode=(camMode+1)%2;syncSeg('segCam',camMode);}
function syncSeg(id,v){document.querySelectorAll('#'+id+' button').forEach(b=>b.setAttribute('aria-pressed',+b.dataset.v===v?'true':'false'));}

/* ================= Audio ================= */
let actx=null,master=null,engO1,engO2,engG,engLP,scrG,muted=false;
function initAudio(){
  if(actx){if(actx.state==='suspended')actx.resume();return;}
  try{
    actx=new (window.AudioContext||window.webkitAudioContext)();
    master=actx.createGain();master.gain.value=muted?0:0.9;master.connect(actx.destination);
    engLP=actx.createBiquadFilter();engLP.type='lowpass';engLP.frequency.value=900;engLP.Q.value=4;
    engG=actx.createGain();engG.gain.value=0;
    engO1=actx.createOscillator();engO1.type='sawtooth';
    engO2=actx.createOscillator();engO2.type='square';
    const g2=actx.createGain();g2.gain.value=0.3;
    engO1.connect(engLP);engO2.connect(g2);g2.connect(engLP);engLP.connect(engG);engG.connect(master);
    engO1.start();engO2.start();
    const buf=actx.createBuffer(1,actx.sampleRate,actx.sampleRate),d=buf.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;
    const ns=actx.createBufferSource();ns.buffer=buf;ns.loop=true;
    const bp=actx.createBiquadFilter();bp.type='bandpass';bp.frequency.value=2300;bp.Q.value=2.5;
    scrG=actx.createGain();scrG.gain.value=0;ns.connect(bp);bp.connect(scrG);scrG.connect(master);ns.start();
  }catch(e){actx=null;}
}
function beep(f,dur,vol){if(!actx)return;const o=actx.createOscillator(),g=actx.createGain();o.type='square';o.frequency.value=f;g.gain.value=vol||0.08;g.gain.setTargetAtTime(0,actx.currentTime+dur*0.7,0.03);o.connect(g);g.connect(master);o.start();o.stop(actx.currentTime+dur+0.1);}
let lastThud=0;
function thud(force){if(!actx)return;const now=actx.currentTime;if(now-lastThud<0.25)return;lastThud=now;const o=actx.createOscillator(),g=actx.createGain();o.type='triangle';o.frequency.setValueAtTime(110,now);o.frequency.exponentialRampToValueAtTime(40,now+0.25);g.gain.setValueAtTime(clamp(force/40,0.05,0.35),now);g.gain.exponentialRampToValueAtTime(0.001,now+0.3);o.connect(g);g.connect(master);o.start(now);o.stop(now+0.35);}
const GEARS=[15,26,37,50,63,90];
function updateAudio(){
  if(!actx)return;const t=actx.currentTime;
  const live=state==='race'||state==='finished'||state==='countdown';
  const v=Math.hypot(player.vx,player.vz);
  let lo=0,gear=6,gearF=1;
  for(let g=0;g<GEARS.length;g++){if(v<GEARS[g]||g===GEARS.length-1){gear=g+1;gearF=clamp((v-lo)/(GEARS[g]-lo),0,1);break;}lo=GEARS[g]*0.62;}
  let rpm=state==='countdown'?(player.throttle?0.75:0.15):(v<1?(player.throttle?0.4:0.12):0.25+0.75*gearF);
  const f=48+rpm*150+gear*6;
  engO1.frequency.setTargetAtTime(f,t,0.05);engO2.frequency.setTargetAtTime(f*0.5,t,0.05);
  engLP.frequency.setTargetAtTime(500+rpm*1600+player.throttle*400,t,0.08);
  engG.gain.setTargetAtTime(live?0.05+player.throttle*0.05:0,t,0.08);
  const sl=live?clamp((player.slip-3.5)/9,0,1)*(Math.abs(player.lat)<W+1?1:0.2):0;
  scrG.gain.setTargetAtTime(sl*0.09,t,0.05);
}

/* ================= HUD ================= */
const mapC=$('map'),mctx=mapC.getContext('2d');
function sizeMap(){const r=mapC.getBoundingClientRect(),d=Math.min(window.devicePixelRatio||1,2);mapC.width=Math.max(1,r.width*d);mapC.height=Math.max(1,r.height*d);}
// the track outline is drawn once into an offscreen canvas; each frame only blits it and adds the car dots
let mapBg=null,mapKey='',mapOX=0,mapOZ=0,mapScale=1;
function mapX(x){return mapOX+(x-minX)*mapScale;}
function mapZ(z){return mapOZ+(z-minZ)*mapScale;}
function drawMap(){
  const w=mapC.width,h=mapC.height,pad=w*0.08;
  const sx=(w-pad*2)/(maxX-minX),sz=(h-pad*2)/(maxZ-minZ),s=Math.min(sx,sz);
  mapScale=s;mapOX=(w-(maxX-minX)*s)/2;mapOZ=(h-(maxZ-minZ)*s)/2;
  const key=w+'x'+h+':'+COURSE+':'+N;
  if(!mapBg||mapKey!==key){
    mapKey=key;mapBg=document.createElement('canvas');mapBg.width=w;mapBg.height=h;
    const g=mapBg.getContext('2d');
    g.lineJoin='round';g.lineCap='round';
    g.strokeStyle='rgba(255,255,255,.22)';g.lineWidth=w*0.06;
    g.beginPath();for(let i=0;i<=N;i+=4){const j=i%N;i?g.lineTo(mapX(PX[j]),mapZ(PZ[j])):g.moveTo(mapX(PX[j]),mapZ(PZ[j]));}g.closePath();g.stroke();
    g.strokeStyle='rgba(238,243,248,.85)';g.lineWidth=w*0.018;g.stroke();
    g.fillStyle='#ffb81c';g.fillRect(mapX(PX[0])-w*0.03,mapZ(PZ[0])-w*0.008,w*0.06,w*0.016);
  }
  mctx.clearRect(0,0,w,h);
  mctx.drawImage(mapBg,0,0);
  for(const c of cars){if(c===player)continue;mctx.fillStyle=c.hex;mctx.strokeStyle='rgba(0,0,0,.6)';mctx.lineWidth=w*0.01;mctx.beginPath();mctx.arc(mapX(c.x),mapZ(c.z),w*0.03,0,7);mctx.fill();mctx.stroke();}
  mctx.fillStyle='#ffb81c';mctx.strokeStyle='#111';mctx.lineWidth=w*0.014;mctx.beginPath();mctx.arc(mapX(player.x),mapZ(player.z),w*0.045,0,7);mctx.fill();mctx.stroke();
}
let msgTimer=0;
function flash(text,warn){const m=$('msg');m.textContent=text;m.classList.toggle('warn',!!warn);m.classList.add('show');msgTimer=2.2;}
function ranking(){
  return cars.slice().sort((a,b)=>{
    if(a.finished&&b.finished)return a.finishT-b.finishT;
    if(a.finished)return -1;if(b.finished)return 1;
    return progress(b)-progress(a);
  });
}
const hudEl={posN:$('posN'),posT:$('posT'),lapN:$('lapN'),spd:$('spd')},hudVal={};
function setHud(k,v){if(hudVal[k]!==v){hudVal[k]=v;hudEl[k].textContent=v;}}
function updateHud(dt){
  const rk=ranking();
  setHud('posN',rk.indexOf(player)+1);setHud('posT',cars.length);
  setHud('lapN',Math.min(Math.max(player.lap,1),LAPS)+' / '+LAPS);
  const v=Math.hypot(player.vx,player.vz)*3.6;
  setHud('spd',Math.round(v));
  if(msgTimer>0){msgTimer-=dt;if(msgTimer<=0)$('msg').classList.remove('show');}
  // wrong way
  if(state==='race'){
    const sp=Math.hypot(player.vx,player.vz);
    const dot=sp>4?(player.vx*TX[player.idx]+player.vz*TZ[player.idx])/sp:1;
    if(dot<-0.4){wrongT+=dt;if(wrongT>0.8&&msgTimer<=0.3)flash('逆走しています',true);}else wrongT=0;
  }
  drawMap();
}

/* ================= Camera ================= */
const tmpV=new THREE.Vector3();
function lerpAngle(a,b,t){return a+wrapA(b-a)*t;}
function updateCamera(dt){
  const c=player,sp=Math.hypot(c.vx,c.vz);
  const portrait=innerHeight>innerWidth;
  let fov=(portrait?74:60)+sp*0.11;
  if(state==='menu'){
    orbitA+=dt*0.18;
    camera.position.set(c.x+Math.cos(orbitA)*17,c.y+5.6,c.z+Math.sin(orbitA)*17);
    camera.position.y=Math.max(camera.position.y,groundY(camera.position.x,camera.position.z)+2);
    camera.lookAt(c.x,c.y+1.4,c.z);fov=portrait?70:55;
  }else if(camMode===0){
    camH=lerpAngle(camH,c.h,1-Math.exp(-dt*5.5));
    const dist=7.8+sp*0.022,hgt=2.9+sp*0.005;
    tmpV.set(c.x-Math.sin(camH)*dist,c.y+hgt,c.z-Math.cos(camH)*dist);
    tmpV.y=Math.max(tmpV.y,groundY(tmpV.x,tmpV.z)+1.6);
    camera.position.lerp(tmpV,1-Math.exp(-dt*14));
    camera.lookAt(c.x+Math.sin(camH)*6,c.y+1.6+Math.tan(c.pitch)*6,c.z+Math.cos(camH)*6);
  }else{
    const fx=Math.sin(c.h),fz=Math.cos(c.h);
    camera.position.set(c.x+fx*0.5,c.y+1.72,c.z+fz*0.5);
    camera.lookAt(c.x+fx*20,c.y+1.3+Math.tan(c.pitch)*20,c.z+fz*20);
    fov+=4;
  }
  if(Math.abs(camera.fov-fov)>0.05){camera.fov+=(fov-camera.fov)*Math.min(1,dt*4);camera.updateProjectionMatrix();}
  sky.position.copy(camera.position);
  sun.position.set(c.x+SUN_OFF[0],c.y+SUN_OFF[1],c.z+SUN_OFF[2]);sun.target.position.set(c.x,c.y,c.z);
  weatherUpdate(dt);
}
/* ================= Tyre smoke ================= */
// One pooled point cloud for every car: rear tyres puff smoke while sliding sideways (drifts, handbrake turns).
const SMOKE_MAX=LOW?240:(IS_TOUCH?320:520);
const smk={pos:new Float32Array(SMOKE_MAX*3),vel:new Float32Array(SMOKE_MAX*3),age:new Float32Array(SMOKE_MAX).fill(9),life:new Float32Array(SMOKE_MAX).fill(1),
  size:new Float32Array(SMOKE_MAX),alpha:new Float32Array(SMOKE_MAX),next:0,acc:new Float32Array(10),dacc:new Float32Array(10),sacc:new Float32Array(10),
  col:new Float32Array(SMOKE_MAX*3),grow:new Float32Array(SMOKE_MAX).fill(1),amax:new Float32Array(SMOKE_MAX).fill(0.62)};
const smokeTex=canvasTex(64,64,(g,w,h)=>{
  const gr=g.createRadialGradient(w/2,h/2,0,w/2,h/2,w/2);
  gr.addColorStop(0,'rgba(255,255,255,1)');gr.addColorStop(.45,'rgba(255,255,255,.55)');gr.addColorStop(1,'rgba(255,255,255,0)');
  g.fillStyle=gr;g.fillRect(0,0,w,h);
});
const smokeGeo=new THREE.BufferGeometry();
smokeGeo.setAttribute('position',new THREE.BufferAttribute(smk.pos,3).setUsage(THREE.DynamicDrawUsage));
smokeGeo.setAttribute('size',new THREE.BufferAttribute(smk.size,1).setUsage(THREE.DynamicDrawUsage));
smokeGeo.setAttribute('alpha',new THREE.BufferAttribute(smk.alpha,1).setUsage(THREE.DynamicDrawUsage));
smokeGeo.setAttribute('col',new THREE.BufferAttribute(smk.col,3).setUsage(THREE.DynamicDrawUsage));
const smokeMat=new THREE.ShaderMaterial({
  transparent:true,depthWrite:false,
  uniforms:{map:{value:smokeTex},scale:{value:400},tint:{value:new THREE.Color(0xd9dde2)}},
  vertexShader:'attribute float size;attribute float alpha;attribute vec3 col;varying float vA;varying vec3 vC;uniform float scale;void main(){vA=alpha;vC=col;vec4 mv=modelViewMatrix*vec4(position,1.0);gl_PointSize=size*scale/max(-mv.z,0.5);gl_Position=projectionMatrix*mv;}',
  fragmentShader:'uniform sampler2D map;varying float vA;varying vec3 vC;void main(){vec4 t=texture2D(map,gl_PointCoord);float a=t.a*vA;if(a<0.01)discard;gl_FragColor=vec4(vC,a);}'
});
const smokePts=new THREE.Points(smokeGeo,smokeMat);smokePts.frustumCulled=false;smokePts.renderOrder=5;scene.add(smokePts);
function smokeClear(){smk.age.fill(9);smk.alpha.fill(0);smk.acc.fill(0);smokeGeo.attributes.alpha.needsUpdate=true;}
function smokeEmit(x,y,z,vx,vz,strength){
  const i=smk.next;smk.next=(i+1)%SMOKE_MAX;
  smk.pos[i*3]=x+(Math.random()-0.5)*0.5;smk.pos[i*3+1]=y;smk.pos[i*3+2]=z+(Math.random()-0.5)*0.5;
  smk.vel[i*3]=vx*0.25+(Math.random()-0.5)*1.2;smk.vel[i*3+1]=0.9+Math.random()*0.9;smk.vel[i*3+2]=vz*0.25+(Math.random()-0.5)*1.2;
  smk.age[i]=0;smk.life[i]=1.3+Math.random()*0.9*strength;
  smk.col[i*3]=0.851;smk.col[i*3+1]=0.867;smk.col[i*3+2]=0.886;smk.grow[i]=1;smk.amax[i]=0.62;
}
// brown dust kicked up by wheels running off the track: heavier, lower and wider than tyre smoke
function dustEmit(x,y,z,vx,vz,strength){
  const i=smk.next;smk.next=(i+1)%SMOKE_MAX;
  smk.pos[i*3]=x+(Math.random()-0.5)*0.8;smk.pos[i*3+1]=y;smk.pos[i*3+2]=z+(Math.random()-0.5)*0.8;
  smk.vel[i*3]=vx*0.35+(Math.random()-0.5)*2.2;smk.vel[i*3+1]=0.9+Math.random()*1.6;smk.vel[i*3+2]=vz*0.35+(Math.random()-0.5)*2.2;
  smk.age[i]=0;smk.life[i]=1.2+Math.random()*1.2*strength;
  const sh=0.85+Math.random()*0.25;smk.col[i*3]=0.56*sh;smk.col[i*3+1]=0.40*sh;smk.col[i*3+2]=0.24*sh;
  smk.grow[i]=1.6;smk.amax[i]=0.5+0.2*strength;
}
function sprayEmit(x,y,z,vx,vz){
  const i=smk.next;smk.next=(i+1)%SMOKE_MAX;
  smk.pos[i*3]=x+(Math.random()-0.5)*0.6;smk.pos[i*3+1]=y;smk.pos[i*3+2]=z+(Math.random()-0.5)*0.6;
  smk.vel[i*3]=vx*0.55+(Math.random()-0.5)*1.6;smk.vel[i*3+1]=0.6+Math.random()*0.8;smk.vel[i*3+2]=vz*0.55+(Math.random()-0.5)*1.6;
  smk.age[i]=0;smk.life[i]=0.7+Math.random()*0.5;
  smk.col[i*3]=0.78;smk.col[i*3+1]=0.81;smk.col[i*3+2]=0.84;smk.grow[i]=1.7;smk.amax[i]=0.3;
}
const REAR_Z=-1.30*CAR_SCALE,REAR_X=0.775*CAR_SCALE;
function smokeUpdate(dt){
  // emit
  cars.forEach((c,ci)=>{
    const sp=Math.hypot(c.vx,c.vz);
    // off the track: dust from all four wheels, more with speed
    const off=Math.abs(c.lat)>W+0.3&&sp>3;
    if(off){
      const kd=clamp((sp-3)/30,0.25,1);smk.dacc[ci]+=dt*kd*(IS_TOUCH?55:85);
      const fx=Math.sin(c.h),fz=Math.cos(c.h),rx=-fz,rz=fx;
      while(smk.dacc[ci]>=1){smk.dacc[ci]-=1;
        const zz=Math.random()<0.65?REAR_Z:-REAR_Z*0.95,s=Math.random()<0.5?1:-1;
        dustEmit(c.x+fx*zz+rx*s*REAR_X,c.y+0.2,c.z+fz*zz+rz*s*REAR_X,c.vx,c.vz,kd);}
    }else smk.dacc[ci]=0;
    // rain: fine spray thrown up behind the rear tyres at speed
    if(WEATHER===1&&sp>10&&!off){smk.sacc[ci]+=dt*clamp((sp-10)/40,0,1)*(IS_TOUCH?26:40);
      const fx=Math.sin(c.h),fz=Math.cos(c.h),rx=-fz,rz=fx;
      while(smk.sacc[ci]>=1){smk.sacc[ci]-=1;const s=Math.random()<0.5?1:-1;sprayEmit(c.x+fx*REAR_Z*1.25+rx*s*REAR_X,c.y+0.3,c.z+fz*REAR_Z*1.25+rz*s*REAR_X,c.vx,c.vz);}}
    const k=(sp>4&&Math.abs(c.lat)<W+1.5)?clamp((c.slip-3.6)/7,0,1):0;
    if(k<=0){smk.acc[ci]=0;return;}
    smk.acc[ci]+=dt*k*(IS_TOUCH?44:66);
    const fx=Math.sin(c.h),fz=Math.cos(c.h),rx=-fz,rz=fx;
    while(smk.acc[ci]>=1){smk.acc[ci]-=1;
      const emit=WEATHER===1?sprayEmit:smokeEmit;
      emit(c.x+fx*REAR_Z+rx*REAR_X,c.y+0.25,c.z+fz*REAR_Z+rz*REAR_X,c.vx,c.vz,k);
      emit(c.x+fx*REAR_Z-rx*REAR_X,c.y+0.25,c.z+fz*REAR_Z-rz*REAR_X,c.vx,c.vz,k);
    }
  });
  // simulate
  for(let i=0;i<SMOKE_MAX;i++){
    const a=smk.age[i];
    if(a>=smk.life[i]){smk.alpha[i]=0;continue;}
    const na=a+dt;smk.age[i]=na;const t=na/smk.life[i];
    const damp=Math.exp(-dt*1.6);
    smk.vel[i*3]*=damp;smk.vel[i*3+2]*=damp;smk.vel[i*3+1]*=Math.exp(-dt*0.8);
    smk.pos[i*3]+=smk.vel[i*3]*dt;smk.pos[i*3+1]+=smk.vel[i*3+1]*dt;smk.pos[i*3+2]+=smk.vel[i*3+2]*dt;
    smk.size[i]=(1.4+t*5.4)*smk.grow[i];
    smk.alpha[i]=smk.amax[i]*Math.min(1,na*6)*(1-t)*(1-t*0.6);
  }
  smokeGeo.attributes.position.needsUpdate=true;smokeGeo.attributes.size.needsUpdate=true;smokeGeo.attributes.alpha.needsUpdate=true;smokeGeo.attributes.col.needsUpdate=true;
  smokeMat.uniforms.scale.value=renderer.domElement.height/(2*Math.tan(camera.fov*Math.PI/360));
}

function updateCarVisuals(dt){
  for(const c of cars){
    {const dt2=Math.atan(GR[c.idx]*(Math.sin(c.h)*TX[c.idx]+Math.cos(c.h)*TZ[c.idx]));c.pitch+=(dt2-c.pitch)*Math.min(1,dt*8);}
    c.group.position.set(c.x,c.y,c.z);c.group.rotation.y=c.h;c.group.rotation.x=-c.pitch;
    {const t=TB[c.idx],ro=t?Math.atan(Math.abs(t))*(t>0?-1:1)*Math.sign(Math.sin(c.h)*TX[c.idx]+Math.cos(c.h)*TZ[c.idx]):0;c.roll=(c.roll||0)+(ro-(c.roll||0))*Math.min(1,dt*8);c.group.rotation.z=c.roll;}
    const vf=c.vf||0;
    if(c.model){
      _qS.setFromAxisAngle(_Y,-c.steer*0.5);
      for(const w of c.model.wheels){
        w.a+=w.sgn*vf*dt/WHEEL_R;
        _qX.setFromAxisAngle(_X,w.a);
        w.node.quaternion.copy(w.q0).multiply(_qX);
        if(w.front)w.node.quaternion.premultiply(_qS);
      }
      c.model.tail.emissiveIntensity=c.brake>0?2.5:(WX[WEATHER].lights?1.3:0.5);
      {const dx=c.x-camera.position.x,dz=c.z-camera.position.z,d2=dx*dx+dz*dz,near=LOW?false:(c.model.near?d2<38*38:d2<32*32);
       if(near!==c.model.near){c.model.near=near;for(const o of c.model.fine)o.visible=near;for(const t of c.model.tyres)t[0].geometry=near?t[1]:t[2];}
       // LOW: CPU cars use the full model up close, the reduced-polygon LOD to 500 m, the simple body beyond
       if(LOW&&!c.isPlayer){const M=c.model,cur=M.lv;
         let lv=cur<=0?(d2>15*15?1:0):(d2<13*13?0:1);
         if(lv===1&&(cur===2?d2>480*480:d2>500*500))lv=2;
         if(lv===1&&!M.lod)lv=0;
         if(lv!==cur){M.lv=lv;M.lodFar=lv===2;M.wrap.visible=lv===0;if(M.lod)M.lod.visible=lv===1;for(const o of M.simple)o.visible=lv===2;}}}
      continue;
    }
    for(const w of c.wheels)w.rotation.x+=vf*dt/0.36;
    for(const p of c.pivots)p.rotation.y=-c.steer*0.5;
    c.tailMat.emissiveIntensity=c.brake>0?2.2:0.35;
    c.group.visible=!(c===player&&camMode===1&&state!=='menu')||true;
  }
}

/* ================= Weather ================= */
// presets: fog, sky gradient, hemisphere + sun light, sun direction, road surface, distant hills, lamps, rain
const WX=[
  {fog:0xbfd2e2,fn:220,ff:1700,top:0x3b78cc,mid:0xb7d0e6,bot:0xc9d6df,hs:0xd6e6ff,hg:0x4d5a3c,hi:0.62,sc:0xfff0d8,si:1.15,so:[70,140,45],road:[0xffffff,0.86,0.0,1.0],hill:null,lights:0,rain:0},
  {fog:0x8b949c,fn:30,ff:620,top:0x58616b,mid:0x8b949c,bot:0x8b949c,hs:0xb0bac4,hg:0x343b31,hi:0.78,sc:0xd2dae2,si:0.3,so:[40,150,30],road:[0x9a9da1,0.26,0.12,1.5],hill:0x7c858d,lights:1,rain:1},
  {fog:0xd9966b,fn:160,ff:1450,top:0x26346a,mid:0xf3a364,bot:0xd9966b,hs:0xffb98a,hg:0x3b303d,hi:0.42,sc:0xff9a52,si:1.3,so:[150,40,-75],road:[0xffffff,0.78,0.0,1.0],hill:0x6c5878,lights:1,rain:0},
];
const SUN_OFF=[70,140,45],RAIN_MATS=new Set(),GLOWS=[],HEAD={x:0,y:0,z:0};
const glowMat=new THREE.SpriteMaterial({map:smokeTex,color:0xfff1d2,blending:THREE.AdditiveBlending,transparent:true,depthWrite:false,opacity:0.9});
// player headlight beam lighting the road ahead (intensity 0 in clear weather, so no shader change between weathers)
const headSpot=new THREE.SpotLight(0xfff0d8,0,80,0.55,0.55,1.2);scene.add(headSpot);scene.add(headSpot.target);
// rain: streaks in a box that follows the camera, wrapped in world space so they stream past as you drive
const RAIN_N=LOW?900:(IS_TOUCH?1500:2800),RB=[64,34,64];
const rainPos=new Float32Array(RAIN_N*6),rainW=new Float32Array(RAIN_N*3);
for(let i=0;i<RAIN_N;i++){rainW[i*3]=Math.random()*RB[0];rainW[i*3+1]=Math.random()*RB[1];rainW[i*3+2]=Math.random()*RB[2];}
const rainGeo=new THREE.BufferGeometry();rainGeo.setAttribute('position',new THREE.BufferAttribute(rainPos,3).setUsage(THREE.DynamicDrawUsage));
const rain=new THREE.LineSegments(rainGeo,new THREE.LineBasicMaterial({color:0xcdd6df,transparent:true,opacity:0.42,depthWrite:false,fog:false}));
rain.frustumCulled=false;rain.visible=false;rain.renderOrder=7;scene.add(rain);
let rainT=0;
function applyWeather(w){
  WEATHER=w;const P=WX[w];
  scene.fog.color.setHex(P.fog);scene.fog.near=LOW?Math.min(P.fn,60):P.fn;scene.fog.far=LOW?Math.min(P.ff,390):P.ff;
  skyMat.uniforms.top.value.setHex(P.top);skyMat.uniforms.mid.value.setHex(P.mid);skyMat.uniforms.bot.value.setHex(P.bot);
  hemi.color.setHex(P.hs);hemi.groundColor.setHex(P.hg);hemi.intensity=P.hi;
  sun.color.setHex(P.sc);sun.intensity=P.si;SUN_OFF[0]=P.so[0];SUN_OFF[1]=P.so[1];SUN_OFF[2]=P.so[2];
  envGen();
  if(ROAD_MAT){ROAD_MAT.color.setHex(P.road[0]);ROAD_MAT.roughness=P.road[1];ROAD_MAT.metalness=P.road[2];ROAD_MAT.envMapIntensity=P.road[3];}
  if(HILL_MAT)HILL_MAT.color.setHex(P.hill==null?HILL_MAT.userData.base:P.hill);
  for(const g of GLOWS)g.visible=P.lights>0;
  headSpot.intensity=P.lights?(w===1?2.2:1.6):0;
  if(LOW)headSpot.visible=headSpot.intensity>0;   // an unlit spot still costs per-vertex lighting work
  rain.visible=!!P.rain;
  for(const m of RAIN_MATS)m.emissiveIntensity=1;
}
function weatherUpdate(dt){
  const c=player,fx=Math.sin(c.h),fz=Math.cos(c.h);
  if(headSpot.intensity>0){headSpot.position.set(c.x+fx*2.4,c.y+0.9,c.z+fz*2.4);headSpot.target.position.set(c.x+fx*28,c.y,c.z+fz*28);headSpot.target.updateMatrixWorld();}
  if(!rain.visible)return;
  rainT+=dt;
  // rear rain light flashes like a race car's
  const on=(rainT*4|0)%2===0;for(const m of RAIN_MATS)m.emissiveIntensity=on?7:0.3;
  const cp=camera.position,ox=cp.x-RB[0]/2,oy=cp.y-RB[1]*0.45,oz=cp.z-RB[2]/2,fall=26*dt,L=0.6;
  for(let i=0;i<RAIN_N;i++){
    let y=rainW[i*3+1]-fall;if(y<0)y+=RB[1];rainW[i*3+1]=y;
    let x=(rainW[i*3]-ox)%RB[0];if(x<0)x+=RB[0];let z=(rainW[i*3+2]-oz)%RB[2];if(z<0)z+=RB[2];
    const wx=ox+x,wy=oy+y,wz=oz+z,k=i*6;
    rainPos[k]=wx;rainPos[k+1]=wy;rainPos[k+2]=wz;rainPos[k+3]=wx+0.08;rainPos[k+4]=wy+L;rainPos[k+5]=wz+0.03;
  }
  rainGeo.attributes.position.needsUpdate=true;
}
WX_READY=true;applyWeather(WEATHER);
document.querySelectorAll('#segQuality button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.v===QPREF?'true':'false'));
{const e=$('qualityNote');if(e)e.textContent='画質：'+(LOW?'軽量':'高画質')+(QPREF==='auto'?'（自動判定'+(GPU_INFO.soft?'・GPU アクセラレーションなし）':'）'):'（手動設定）');}
document.querySelectorAll('#segWeather button').forEach(b=>b.setAttribute('aria-pressed',+b.dataset.v===WEATHER?'true':'false'));

/* ================= Flow ================= */
const lights=[...document.querySelectorAll('#lights i')];
function startRace(){
  initAudio();
  placeGrid();
  $('menu').hidden=true;$('result').hidden=true;$('pause').hidden=true;$('hud').hidden=false;
  $('touch').hidden=!IS_TOUCH;
  $('lights').hidden=false;lights.forEach(l=>l.className='');
  sizeMap();
  state='countdown';cdT=4.0;raceT=0;resultTimer=-1;lastCd=-1;
  $('cd').textContent='';$('cd').className='';
}
let lastCd=-1;
// the gantry's red start lamps glow during the countdown and go out at the start
function setStartLamps(v){if(!PROPS||!PROPS.Prop_Gantry)return;for(const pt of PROPS.Prop_Gantry)if(pt.m.name==='P_StartLamp'&&pt.m.emissive){pt.m.emissiveIntensity=v;}}
function countdown(dt){
  cdT-=dt;
  const n=Math.ceil(cdT-1);// 3,2,1
  if(cdT>1){
    const lit=clamp(Math.floor((4-cdT)/0.6)+1,0,5);
    lights.forEach((l,i)=>l.className=i<lit?'on':'');
    setStartLamps(lit>0?3.2:0);
    if(n!==lastCd&&n>=1&&n<=3){lastCd=n;$('cd').textContent=n;$('cd').className='';beep(440,0.18);}
  }else if(state==='countdown'){
    state='race';raceT=0;lights.forEach(l=>l.className='go');setStartLamps(0);
    $('cd').textContent='GO';$('cd').className='go';beep(880,0.4,0.1);
    setTimeout(()=>{$('cd').textContent='';$('lights').hidden=true;},900);
  }
}
function showResults(){
  state='results';
  const rk=ranking();
  const pos=rk.indexOf(player)+1;
  $('resHead').textContent=pos===1?'優勝！ 1位でフィニッシュ':pos+'位でフィニッシュ';
  $('resTotal').textContent=fmt(player.finishT);
  const lp=player.laps||[],fast=Math.min(...lp);
  $('resLaps').innerHTML=lp.length?lp.map((t,i)=>'<li'+(t===fast&&lp.length>1?' class="fast"':'')+'><span>LAP '+(i+1)+'</span>'+fmt(t)+'</li>').join(''):'<li>-</li>';
  const lead=rk[0];
  $('resBody').innerHTML=rk.map((c,i)=>{
    let t;
    if(c.finished)t=i===0?fmt(c.finishT):'+'+(c.finishT-lead.finishT).toFixed(3);
    else{const laps=player.lap-c.lap;t=laps>=1&&c.idx<player.idx?'+'+laps+' LAP':'走行中';}
    return '<tr class="'+(c.isPlayer?'me':'')+'"><td class="p">'+(i+1)+'</td><td><span class="swatch" style="background:'+c.hex+'"></span>'+c.name+'</td><td class="t">'+t+'</td></tr>';
  }).join('');
  $('result').hidden=false;$('touch').hidden=true;
}
function toTitle(){
  state='menu';$('hud').hidden=true;$('pause').hidden=true;$('result').hidden=true;$('menu').hidden=false;
  placeGrid();updateBestNote();
}
function togglePause(){
  if(state==='race'||state==='countdown'||state==='finished'){pausedFrom=state;state='paused';$('pause').hidden=false;if(actx)actx.suspend();}
  else if(state==='paused'){resume();}
}
let pausedFrom='race';
function resume(){state=pausedFrom;$('pause').hidden=true;if(actx)actx.resume();last=performance.now();}

document.querySelectorAll('.seg').forEach(seg=>{
  seg.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b)return;
    seg.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',x===b?'true':'false'));
    if(seg.id==='segQuality'){const v=b.dataset.v;if(v!==QPREF){try{localStorage.setItem(QKEY,v);}catch(_){}
      const u=new URL(location.href);u.searchParams.delete('quality');location.replace(u.href);}return;}
    if(seg.id==='segDiff'){DIFF=+b.dataset.v;updateBestNote();}
    else if(seg.id==='segCam'){camMode=+b.dataset.v;}
    else if(seg.id==='segSnd'){muted=b.dataset.v==='0';if(master)master.gain.value=muted?0:0.9;}
    else if(seg.id==='segWeather'){applyWeather(+b.dataset.v);}
    else if(seg.id==='segCourse'){const v=+b.dataset.v;if(v!==COURSE){buildTrack(v);placeGrid();updateBestNote();}}
    else LAPS=+b.dataset.v;
  });
});
$('bStart').addEventListener('click',startRace);
$('bRetry1').addEventListener('click',startRace);
$('bRetry2').addEventListener('click',startRace);
$('bTitle1').addEventListener('click',()=>{if(actx)actx.resume();toTitle();});
$('bTitle2').addEventListener('click',toTitle);
$('bResume').addEventListener('click',resume);
$('bPause').addEventListener('click',togglePause);
document.addEventListener('visibilitychange',()=>{if(document.hidden&&(state==='race'||state==='finished'))togglePause();});

function resize(){
  const w=innerWidth,h=innerHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
  if(!$('hud').hidden)sizeMap();
}
addEventListener('resize',resize);resize();

/* ================= Main loop ================= */
let last=performance.now();
const STEP=1/120;
// LOW: as tracks, props and the car model are (re)built, PBR materials are swapped for per-vertex Lambert
// copies (far cheaper per pixel on a CPU rasteriser) and bump/normal maps are dropped. Brake-light materials
// change every frame and stay as they are; other runtime changes (weather) are copied over on each pass.
const _lowMat=new Map(),_lowKeep=new WeakSet();
function lowMat(m){
  if(!m.isMeshStandardMaterial||_lowKeep.has(m))return m;
  let L=_lowMat.get(m);
  if(!L){
    L=new THREE.MeshLambertMaterial({map:m.map,emissiveMap:m.emissiveMap,alphaTest:m.alphaTest,transparent:m.transparent,side:m.side,
      vertexColors:m.vertexColors,fog:m.fog,depthWrite:m.depthWrite,depthTest:m.depthTest,
      polygonOffset:m.polygonOffset,polygonOffsetFactor:m.polygonOffsetFactor,polygonOffsetUnits:m.polygonOffsetUnits});
    L.name=m.name;L.userData=m.userData;
    // foliage cards: light both faces like the front face (the PBR version does the same via its normal chunk)
    if(m.alphaTest>0&&m.side===THREE.DoubleSide)L.onBeforeCompile=sh=>{sh.fragmentShader=sh.fragmentShader
      .replace('( gl_FrontFacing ) ? vIndirectFront : vIndirectBack','vIndirectFront').replace('( gl_FrontFacing ) ? vLightFront : vLightBack','vLightFront');};
    _lowMat.set(m,L);
  }
  return L;
}
function lowifyScene(){
  for(const c of cars){_lowKeep.add(c.tailMat);if(c.model)_lowKeep.add(c.model.tail);}
  const used=new Set();
  scene.traverse(o=>{const ms=o.material;if(!ms||!o.isMesh)return;
    if(Array.isArray(ms))o.material=ms.map(lowMat);else o.material=lowMat(ms);
    for(const m of Array.isArray(o.material)?o.material:[o.material]){used.add(m);if(m.bumpMap||m.normalMap){m.bumpMap=null;m.normalMap=null;m.needsUpdate=true;}
      // anisotropic filtering is very expensive on a CPU rasteriser
      if(m.map&&m.map.anisotropy>1){m.map.anisotropy=1;m.map.needsUpdate=true;}}});
  // copy runtime changes (weather) over; forget copies whose meshes were removed with a rebuilt track
  _lowMat.forEach((L,m)=>{if(!used.has(L)){_lowMat.delete(m);return;}
    L.color.copy(m.color);L.emissive.copy(m.emissive);L.emissiveIntensity=m.emissiveIntensity;L.opacity=m.opacity;L.visible=m.visible;});
}
// LOW: per-instance draw distance for trackside props (trees, tyre walls, fences, billboards...)
const DECOR_R=360;
function decorCull(){
  const list=decorGroup&&decorGroup.userData.cull;if(!list)return;
  const cx=camera.position.x,cz=camera.position.z,R2=DECOR_R*DECOR_R;
  for(const im of list){
    const A=im.userData.all,P=im.userData.pos,dst=im.instanceMatrix.array,k=P.length>>1;let n=0;
    for(let i=0;i<k;i++){const dx=P[i*2]-cx,dz=P[i*2+1]-cz;if(dx*dx+dz*dz<R2){dst.set(A.subarray(i*16,i*16+16),n*16);n++;}}
    if(n!==im.count||n){im.count=n;im.instanceMatrix.needsUpdate=true;}
  }
}
// dynamic resolution: lower the render scale when frames run long, raise it again when there is headroom
let qAcc=0,qN=0,qFrame=0;
function qualityTick(dt){
  qFrame++;
  if(state!=='race'&&state!=='countdown'&&state!=='finished'){qAcc=qN=0;return;}
  qAcc+=dt;qN++;
  if(qAcc<1.5)return;
  const ms=qAcc/qN*1000;qAcc=qN=0;
  let s=renderScale;
  if(LOW){if(ms>45)s=Math.max(0.35,s-0.1);else if(ms<36)s=Math.min(0.8,s+0.05);}
  else{if(ms>26)s=Math.max(0.6,s-0.1);else if(ms<18)s=Math.min(1,s+0.05);}
  s=Math.round(s*100)/100;
  if(s!==renderScale){renderScale=s;renderer.setPixelRatio(DPR_BASE*renderScale);}
}
function frame(now){
  requestAnimationFrame(frame);
  if(LOW&&now-last<1000/30-4)return;   // LOW: render at most ~30 fps (physics still sub-steps at 120 Hz)
  let dt=Math.min(0.05,(now-last)/1000);last=now;
  if(state==='countdown'){countdown(dt);playerInput();}
  if(state==='race'||state==='finished'){
    raceT+=dt;resetCool=Math.max(0,resetCool-dt);
    playerInput();
    for(const c of cars)if(!c.isPlayer)cpuDrive(c);
    const n=Math.ceil(dt/STEP),h=dt/n;
    for(let s=0;s<n;s++){for(const c of cars){stepCar(c,h);trackUpdate(c);}collide();}
    if(state==='finished'){resultTimer-=dt;if(resultTimer<=0)showResults();}
  }
  if(state==='results'){
    // keep the field moving behind the results panel
    raceT+=dt;
    for(const c of cars)cpuDrive(c);
    const n=Math.ceil(dt/STEP),h=dt/n;
    for(let s=0;s<n;s++){for(const c of cars){stepCar(c,h);trackUpdate(c);}collide();}
  }
  if(state==='race'||state==='finished'||state==='results'||state==='countdown')smokeUpdate(dt);
  updateCarVisuals(dt);
  updateCamera(dt);
  if(state!=='menu'&&state!=='paused'&&state!=='results')updateHud(dt);
  updateAudio();
  if(LOW&&qFrame%30===0)lowifyScene();
  if(LOW&&qFrame%8===0)decorCull();
  renderer.render(scene,camera);
  qualityTick(dt);
}
placeGrid();updateBestNote();
requestAnimationFrame(frame);
})();
