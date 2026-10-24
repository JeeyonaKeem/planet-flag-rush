import {C,Player,Flag,State,V,norm,distance,move,rounds,cross,speedMultiplierForRound} from '../shared/game.js';
export class Game {
 state:State; history:number[]=[]; nextSpawn=0; serial=0; lastActive=Date.now(); events:{player:string;value:number;n:V;id:number}[]=[];
 constructor(code:string,host:string){this.state={code,host,phase:'lobby',players:[],flags:[],round:0,mode:'normal',target:0,ends:0,now:0};}
 add(id:string,name:string){const n=norm([Math.random()-.5,Math.random()-.5,Math.random()-.5]);const p:Player={id,name,n,f:norm(cross(n,[0,1,0])),score:0,input:0,connected:true,avatar:this.state.players.length};this.state.players.push(p);return p;}
 spawn(color:number,special=false){for(let i=0;i<300;i++){const y=Math.random()*2-1,a=Math.random()*Math.PI*2,n:V=[Math.sqrt(1-y*y)*Math.cos(a),y,Math.sqrt(1-y*y)*Math.sin(a)];if(this.state.players.some(p=>distance(n,p.n)<C.minSpawnDistance)||this.state.flags.some(f=>distance(n,f.n)<C.flagSeparation))continue;const f:Flag={id:++this.serial,n,color,special,value:special?5:this.state.mode==='fever'&&color===this.state.target?(Math.random()<.7?2:3):1};this.state.flags.push(f);return f;}}
 start(now:number){this.state.phase='playing';this.state.round=-1;this.state.flags=[];this.history=[];for(const p of this.state.players)p.score=0;this.advance(now);}
 // Put flags along the players' travel paths, instead of hiding them on the far side of the planet.
 spawnAhead(color:number,special=false){const players=this.state.players.filter(p=>p.connected);for(let i=0;i<100;i++){
  const p=players[Math.floor(Math.random()*players.length)];if(!p)break;
  const forward=norm(p.f),side=norm(cross(p.n,forward));
  const lateral=(Math.random()-.5)*12,forwardDist=8+Math.random()*17;
  const tangent=norm([forward[0]*forwardDist+side[0]*lateral,forward[1]*forwardDist+side[1]*lateral,forward[2]*forwardDist+side[2]*lateral]);
  const theta=Math.hypot(forwardDist,lateral)/C.radius;
  const n=norm([p.n[0]*Math.cos(theta)+tangent[0]*Math.sin(theta),p.n[1]*Math.cos(theta)+tangent[1]*Math.sin(theta),p.n[2]*Math.cos(theta)+tangent[2]*Math.sin(theta)] as V);
  if(this.state.players.some(x=>distance(n,x.n)<C.minSpawnDistance)||this.state.flags.some(f=>distance(n,f.n)<C.flagSeparation))continue;
  const f:Flag={id:++this.serial,n,color,special,value:special?5:this.state.mode==='fever'?(Math.random()<.7?2:3):1};this.state.flags.push(f);return f;
 }return this.spawn(color,special);}
 refill(){const s=this.state;if(s.mode==='special')return;
  const wanted=16;let count=s.flags.filter(f=>f.color===s.target&&!f.special).length;
  while(count<wanted&&s.flags.length<C.cap){const before=s.flags.length;this.spawnAhead(s.target);if(s.flags.length===before)break;count++;}
 }
 advance(now:number){const s=this.state;s.flags=[];s.round++;if(s.round===rounds.length){s.phase='results';return;}
 s.mode=rounds[s.round];s.target=s.round===0?1:(s.target+1+Math.floor(Math.random()*4))%5;
 s.ends=now+(s.mode==='normal'?30000:20000);
 if(s.mode==='special'){for(let j=0;j<7;j++)this.spawnAhead(-1,true);}else this.refill();
 this.nextSpawn=now+this.interval();}
 interval(){const n=this.history.length;return (n<4?600:n<8?470:n<12?350:250)/(this.state.mode==='fever'?1.4:1);}
 tick(now:number,dt:number){const s=this.state;s.now=now;this.events=[];if(s.phase!=='playing')return;if(now>=s.ends)this.advance(now);if(s.phase!=='playing')return;this.history=this.history.filter(t=>now-t<30000);for(const p of s.players)move(p,dt,C.speed*speedMultiplierForRound(s.round));
 // Resolve each flag once. Shuffle exact ties to avoid permanent join-order advantage.
 for(const f of [...s.flags]){if(s.mode==='special'?!f.special:f.special||f.color!==s.target)continue;const hits=s.players.filter(p=>p.connected&&distance(p.n,f.n)<C.pickup).map(p=>({p,tie:Math.random()})).sort((a,b)=>distance(a.p.n,f.n)-distance(b.p.n,f.n)||a.tie-b.tie).map(x=>x.p);if(hits.length){const p=hits[0];p.score+=f.value;s.flags.splice(s.flags.indexOf(f),1);this.history.push(now);this.events.push({player:p.id,value:f.value,n:f.n,id:f.id});this.nextSpawn=Math.min(this.nextSpawn,now+this.interval());}}
 if(s.mode!=='special'&&now>=this.nextSpawn){this.refill();this.nextSpawn=now+this.interval();}
 }
}
