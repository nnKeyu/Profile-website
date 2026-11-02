'use strict';
const $ = id => document.getElementById(id);
const make = (tag,cls) => Object.assign(document.createElement(tag),{className:cls||''});
const uid = () => Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16).padStart(8,"0")).join("");
let db, state, pageId='index', selected, scale=1, viewing=false, gesture, dragged;
const channel=new BroadcastChannel('km-layout-1');
const page=()=>state.doc.pages.find(p=>p.id===pageId);
const chosen=()=>page()?.layers.find(l=>l.id===selected);
const note=t=>{$('status').textContent=t};
const request=indexedDB.open('km-layout-1',1);
request.onupgradeneeded=()=>request.result.createObjectStore('project');
request.onerror=()=>note('存储不可用，请检查浏览器设置');
request.onsuccess=()=>{
 db=request.result;
 const tx=db.transaction('project','readwrite'), store=tx.objectStore('project'), get=store.get('main');
 get.onsuccess=()=>{if(!get.result)store.put({doc:seed,rev:0,history:[]},'main')};
 tx.oncomplete=refresh;
};
function refresh(){
 if(!db)return;
 const get=db.transaction('project').objectStore('project').get('main');
 get.onsuccess=()=>{
  if(state && get.result.rev<state.rev)return;
  state=get.result;if(!page())pageId=state.doc.pages[0].id;
  if(!gesture)render();
 };
}
channel.onmessage=refresh;
window.addEventListener('focus',refresh);
function change(fn,rev=state.rev,undo=false){
 const tx=db.transaction('project','readwrite'),store=tx.objectStore('project'),read=store.get('main');
 let problem;
 read.onsuccess=()=>{
  const s=read.result;
  if(s.rev!==rev){problem='另一个窗口已更新，请在最新画布重试';tx.abort();return}
  if(undo){if(!s.history.length)return;Object.assign(s.doc,s.history.pop())}
  else{
   const previous=structuredClone(s.doc.pages),oldAssets=s.doc.assets;
   fn(s.doc);
   const snapshot={pages:previous};
   if(oldAssets!==s.doc.assets)snapshot.assets=oldAssets;
   s.history.push(snapshot);if(s.history.length>30)s.history.shift();
  }
  s.rev++;store.put(s,'main');
 };
 tx.oncomplete=()=>{channel.postMessage(1);refresh()};
 tx.onabort=()=>{gesture=null;refresh();setTimeout(()=>note(problem||'保存失败，请导出备份并检查存储空间'),100)};
}
function editLayer(fn,rev=state.rev){
 const pid=pageId,id=selected;
 change(d=>{const l=d.pages.find(p=>p.id===pid)?.layers.find(o=>o.id===id);if(l&&!l.locked)fn(l)},rev);
}
function button(title,action,short=title){
 const b=make('button');b.textContent=short;b.title=b.ariaLabel=title;b.onclick=e=>{e.stopPropagation();action()};return b;
}
function render(){
 const p=page();if(!p)return;
 const pageSelect=$('pages');pageSelect.replaceChildren(...state.doc.pages.map(q=>new Option(q.name,q.id)));pageSelect.value=p.id;
 document.body.classList.toggle('view',viewing);$('preview').textContent=viewing?'返回编辑':'预览 ↗';
 $('undo').disabled=!state.history.length;$('edit').disabled=chosen()?.type!=='text'||chosen()?.locked;
 $('assets').replaceChildren();for(const a of Object.values(state.doc.assets)){
  const b=button(a.name,()=>insert({type:'image',asset:a.id,w:240}),'');const img=make('img');img.src=a.src;img.alt=a.name;b.append(img);$('assets').append(b)
 }
 if(!Object.keys(state.doc.assets).length)$('assets').textContent='上传后，点缩略图放入当前页。';
 $('canvas').replaceChildren();$('layers').replaceChildren();
 for(const l of p.layers){
  const title=l.type==='image'?state.doc.assets[l.asset].name:l.text;
  const row=make('div','layer'+(selected===l.id?' sel':''));row.draggable=true;
  const name=make('span');name.textContent='⠿ '+title;name.title=title;row.append(name);
  row.onclick=()=>{selected=l.id;render()};
  const flag=(key)=>change(d=>{d.pages.find(q=>q.id===p.id).layers.find(o=>o.id===l.id)[key]=!l[key]});
  row.append(button(l.hidden?'显示图层':'隐藏图层',()=>flag('hidden'),l.hidden?'显示':'隐藏'),button(l.locked?'解锁':'锁定',()=>flag('locked'),l.locked?'解锁':'锁定'));
  const del=button('删除画布元素',()=>remove(l.id),'×');del.disabled=l.locked;row.append(del);
  row.ondragstart=e=>{dragged=l.id;e.dataTransfer.setData('text/plain',l.id)};
  row.ondragover=e=>e.preventDefault();
  row.ondrop=e=>{e.preventDefault();const id=dragged;dragged=null;if(!id||id===l.id)return;
   const above=e.clientY<row.getBoundingClientRect().top+row.offsetHeight/2;
   change(d=>{const list=d.pages.find(q=>q.id===p.id).layers;const i=list.findIndex(o=>o.id===id);if(i<0||list[i].locked)return;const [o]=list.splice(i,1);list.splice(list.findIndex(o=>o.id===l.id)+(above?1:0),0,o)})};
  row.ondragend=()=>dragged=null;
  $('layers').prepend(row);
  if(l.hidden)continue;
  const el=make('div','obj'+(l.art?' monogram':'')+(l.link?' link':''));position(el,l);
  if(l.type==='image'){const img=make('img');img.src=state.doc.assets[l.asset].src;img.alt=title;el.append(img)}
  else el.textContent=l.text;
  if(viewing){el.onclick=()=>{if(state.doc.pages.some(q=>q.id===l.link)){pageId=l.link;render()}else if(/^https:\/\/doi\.org\//.test(l.link))window.open(l.link,'_blank','noopener')}}
  else{
   el.onpointerdown=e=>start(e,el,l,'move');
   el.ondblclick=()=>{selected=l.id;if(l.type==='text'&&!l.locked)editText()};
   if(selected===l.id&&!l.locked){el.classList.add('active');for(const mode of ['size','rotate']){
    const h=make('i','handle'+(mode==='rotate'?' rot':''));h.onpointerdown=e=>start(e,el,l,mode);el.append(h)
   }}
  }
  $('canvas').append(el);
 }
 fit();note('已自动保存 · 本机');
}
function position(el,l){
 Object.assign(el.style,{left:l.x+'px',top:l.y+'px',width:l.w+'px',fontSize:(l.size||18)+'px',fontFamily:l.serif?'Georgia,serif':'system-ui,sans-serif',transform:'rotate('+l.angle+'deg)'});
}
function fit(){
 if(!state)return;
 scale=Math.min(1,Math.max(.18,(document.querySelector('.viewport').clientWidth-(innerWidth<=720?12:44))/1000));
 const h=Math.max(page().height,...page().layers.map(l=>l.y+150));
 $('canvas').style.height=h+'px';$('canvas').style.transform='scale('+scale+')';
 $('frame').style.width=1000*scale+'px';$('frame').style.height=h*scale+'px';$('zoom').textContent=Math.round(scale*100)+'%';
}
new ResizeObserver(fit).observe(document.querySelector('.viewport'));
function start(e,el,l,mode){
 if(e.button!==0||gesture)return;e.stopPropagation();selected=l.id;
 if(l.locked){render();return}
 const r=el.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2;
 const sx=e.clientX,sy=e.clientY,begin=Math.atan2(sy-cy,sx-cx),distance=Math.max(1,Math.hypot(sx-cx,sy-cy)),rev=state.rev;
 let draft={...l},moved=false;gesture=true;el.setPointerCapture(e.pointerId);
 el.onpointermove=ev=>{
  const dx=ev.clientX-sx,dy=ev.clientY-sy;if(Math.hypot(dx,dy)<3&&!moved)return;moved=true;
  if(mode==='move'){draft.x=Math.max(0,Math.min(980,l.x+dx/scale));draft.y=Math.max(0,l.y+dy/scale)}
  if(mode==='rotate')draft.angle=l.angle+(Math.atan2(ev.clientY-cy,ev.clientX-cx)-begin)*180/Math.PI;
  if(mode==='size'){const f=Math.max(24/l.w,Math.min(2000/l.w,Math.hypot(ev.clientX-cx,ev.clientY-cy)/distance));draft.w=l.w*f;if(l.size)draft.size=l.size*f}
  position(el,draft)
 };
 el.onpointercancel=()=>{gesture=null;refresh()};
 el.onpointerup=()=>{
  el.onpointermove=null;el.onpointerup=null;gesture=null;
  if(moved)editLayer(o=>Object.assign(o,draft),rev);
  else if(l.type==='text'&&lastTap.id===l.id&&performance.now()-lastTap.at<400){lastTap={};render();editText()}
  else{lastTap={id:l.id,at:performance.now()};render()}
 };
}
let lastTap={};
function insert(props){
 const pid=pageId,id=uid();selected=id;
 change(d=>d.pages.find(p=>p.id===pid).layers.push({id,x:75,y:110,w:430,size:30,angle:0,...props}));
}
function remove(id){
 const pid=pageId;change(d=>{const p=d.pages.find(q=>q.id===pid);p.layers=p.layers.filter(l=>l.id!==id||l.locked)});
}
function ask(label,value,done){
 const dialog=$('dialog');$('label').textContent=label;$('entry').value=value;
 dialog.returnValue='';dialog.onclose=()=>{const t=$('entry').value.trim();if(dialog.returnValue==='ok'&&t)done(t)};
 dialog.showModal();$('entry').focus();$('entry').select();
}
function editText(){const rev=state.rev;ask('编辑文字',chosen().text,t=>editLayer(l=>l.text=t,rev))}
$('edit').onclick=editText;
$('addText').onclick=()=>ask('新文字','',t=>insert({type:'text',text:t}));
$('pages').onchange=e=>{pageId=e.target.value;selected=null;render()};
$('addPage').onclick=()=>ask('新页面名称','',name=>{const id=uid();change(d=>{d.pages.push({id,name,height:800,layers:[]});pageId=id})});
$('rename').onclick=()=>{const pid=pageId,rev=state.rev;ask('重命名页面',page().name,name=>change(d=>{d.pages.find(q=>q.id===pid).name=name;for(const p of d.pages)for(const l of p.layers)if(l.link===pid&&l.text===page().name)l.text=name},rev))};
$('preview').onclick=()=>{viewing=!viewing;render()};
$('canvas').onpointerdown=e=>{if(e.target===$('canvas')){selected=null;render()}};
$('undo').onclick=()=>change(null,state.rev,true);
document.onkeydown=e=>{if($('dialog').open||viewing||!state||['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))return;
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();$('undo').click()}
 if((e.key==='Delete'||e.key==='Backspace')&&chosen()&&!chosen().locked){e.preventDefault();remove(selected)}
};
$('upload').onclick=()=>$('files').click();
const imageData=/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
$('files').onchange=async e=>{
 const files=[...e.target.files];e.target.value='';
 try{const assets=[];for(const f of files){
  const src=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(f)});
  if(!imageData.test(src))throw Error('请选择 PNG、JPEG、WebP 或 GIF 图片');
  const img=new Image();img.src=src;await img.decode();assets.push({id:uid(),name:f.name,src});
 }change(d=>{d.assets={...d.assets};for(const a of assets)d.assets[a.id]=a})}catch(err){alert('上传失败。'+err.message)}
};
$('exp').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(state.doc)],{type:'application/json'}));const a=make('a');a.href=url;a.download='Keyu-layout.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000)};
function valid(d){
 const obj=v=>v&&typeof v==='object'&&!Array.isArray(v);
 const ids=a=>new Set(a.map(x=>x.id)).size===a.length;
 return obj(d)&&d.version===1&&obj(d.assets)&&Object.entries(d.assets).every(([k,a])=>obj(a)&&k===a.id&&typeof a.name==='string'&&imageData.test(a.src))&&Array.isArray(d.pages)&&d.pages.length>0&&ids(d.pages)&&d.pages.every(p=>obj(p)&&typeof p.id==='string'&&typeof p.name==='string'&&Number.isFinite(p.height)&&p.height>0&&Array.isArray(p.layers)&&ids(p.layers)&&p.layers.every(l=>obj(l)&&typeof l.id==='string'&&[l.x,l.y,l.w,l.angle].every(Number.isFinite)&&l.w>0&&(l.type==='text'?typeof l.text==='string'&&Number.isFinite(l.size)&&l.size>0:l.type==='image'&&Object.hasOwn(d.assets,l.asset))));
}
$('imp').onclick=()=>$('projectFile').click();
$('projectFile').onchange=async e=>{const f=e.target.files[0];e.target.value='';if(!f)return;try{
 const d=JSON.parse(await f.text());if(!valid(d))throw Error();
 if(confirm('用导入的项目替换当前画布和素材库？可撤销。'))change(doc=>Object.assign(doc,d));
}catch{alert('无法导入。请选择从本编辑器导出的完整项目 JSON。')}};
