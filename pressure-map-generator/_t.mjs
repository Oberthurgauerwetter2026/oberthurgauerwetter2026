import { buildSvg } from "./_test-gen.mjs";
import { writeFileSync } from "node:fs";
const COLS=36, ROWS=21;
const mk=(f)=>{const v=new Array(COLS*ROWS);for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++)v[r*COLS+c]=f(c,r);return {values:v,cols:COLS,rows:ROWS};};
const grids={
 pressure: mk((c,r)=>1013+18*Math.sin(c/6)*Math.cos(r/5)-6*Math.sin(r/3)),
 t850: mk((c,r)=>18-1.6*r+3*Math.sin(c/4)),
 precip: mk((c,r)=>Math.max(0,12*Math.sin(c/3)*Math.cos(r/4))),
};
const ex=[{type:"H",lon:5,lat:52,value:1029,name:"Zeno"},{type:"T",lon:-12,lat:58,value:986,name:"Inga"},{type:"T",lon:25,lat:44,value:1002,name:"Henriette"}];
writeFileSync("/tmp/browser/map.svg", buildSvg(grids,"2026-07-30T12:00",ex));
