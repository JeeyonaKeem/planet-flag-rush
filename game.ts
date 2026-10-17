export const C={radius:40,speed:6,turn:150*Math.PI/180,tick:30,snapshot:15,maxPlayers:6,cap:20,pickup:1.8,minSpawnDistance:9,flagSeparation:5,viewDistance:27,reconnectMs:30000};
export const colors=['#ff5c68','#479aff','#ffdf58','#45df98','#b98aff'];
export const names=['빨강','파랑','노랑','초록','보라'];
export type V=[number,number,number];
export const dot=(a:V,b:V)=>a.reduce((s,n,i)=>s+n*b[i],0);
export const add=(a:V,b:V):V=>a.map((n,i)=>n+b[i]) as V;
export const mul=(a:V,n:number):V=>a.map(x=>x*n) as V;
export const norm=(a:V):V=>mul(a,1/(Math.hypot(...a)||1));
export const cross=(a:V,b:V):V=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const distance=(a:V,b:V)=>Math.acos(Math.max(-1,Math.min(1,dot(a,b))))*C.radius;
export function move(p:Player,dt:number){const a=-p.input*C.turn*dt; p.f=norm(add(mul(p.f,Math.cos(a)),mul(cross(p.n,p.f),Math.sin(a))));const t=C.speed*dt/C.radius,old=p.n;p.n=norm(add(mul(old,Math.cos(t)),mul(p.f,Math.sin(t))));p.f=norm(add(mul(p.f,Math.cos(t)),mul(old,-Math.sin(t))));}
export interface Player{id:string;name:string;n:V;f:V;score:number;input:number;connected:boolean;avatar:number}
export interface Flag{id:number;n:V;color:number;value:number;special:boolean}
export type Mode='normal'|'fever'|'special';
export const rounds:Mode[]=['normal','normal','normal','fever','normal','normal','normal','special','normal','fever','normal','normal'];
export interface State{code:string;host:string;phase:'lobby'|'playing'|'results';players:Player[];flags:Flag[];round:number;mode:Mode;target:number;ends:number;now:number}
