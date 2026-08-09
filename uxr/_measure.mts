import { chromium } from '@playwright/test';
const exe='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const files=process.argv.slice(2);
const b=await chromium.launch({executablePath:exe});
for(const f of files){
  const ctx=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
  const p=await ctx.newPage();
  await p.goto('file://'+f);
  const out=await p.evaluate(()=>{
    const rs:any[]=[];
    document.querySelectorAll('button,select,input,label,summary,a').forEach((e)=>{
      const r=e.getBoundingClientRect();
      if(r.width===0&&r.height===0) return;
      rs.push({tag:e.tagName, t:(e.textContent||'').trim().slice(0,34), x:Math.round(r.x),y:Math.round(r.y+window.scrollY),w:Math.round(r.width),h:Math.round(r.height)});
    });
    const doc=document.documentElement.scrollHeight;
    return {rs,doc};
  });
  console.log('==',f,'pageH',out.doc);
  for(const r of out.rs) console.log(`${r.tag.padEnd(8)} x${String(r.x).padStart(4)} y${String(r.y).padStart(5)} ${String(r.w).padStart(4)}x${String(r.h).padStart(3)}  ${r.t}`);
  await ctx.close();
}
await b.close();
