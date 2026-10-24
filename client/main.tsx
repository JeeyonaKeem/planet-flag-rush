import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {io, Socket} from 'socket.io-client';
import {State, colors, names, speedMultiplierForRound} from '../shared/game';
import {createScene} from './scene';
import './style.css';

type Announcement = {title:string; detail:string; kind:'normal'|'fever'|'special'|'turbo'};
let audio: AudioContext | null = null;
function tone(freq=650,duration=.12,volume=.065){
  if (!audio) return;
  const o=audio.createOscillator(),g=audio.createGain();
  o.connect(g);g.connect(audio.destination);
  o.type='triangle';o.frequency.value=freq;
  g.gain.setValueAtTime(volume,audio.currentTime);
  g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+duration);
  o.start();o.stop(audio.currentTime+duration);
}
function fanfare(mode:'fever'|'special'|'turbo'){
  const notes=mode==='special'?[784,988,1175,1568]:mode==='fever'?[659,880,1047,1318]:[523,698,880,1047];
  notes.forEach((hz,i)=>window.setTimeout(()=>tone(hz,.2,.085),i*105));
}
function roundAnnouncement(st:State):Announcement{
  const speed=speedMultiplierForRound(st.round);
  if(st.mode==='special') return {title:'🌟 황금 깃발 러시!',detail:`금색 깃발만 먹어! 하나당 5점${speed>1?' · 터보 속도 '+speed.toFixed(2)+'배':''}`,kind:'special'};
  if(st.mode==='fever') return {title:'🔥 피버 타임!',detail:`${names[st.target]} 깃발 하나당 2~3점! 연속으로 먹어!`,kind:'fever'};
  if(st.round===10) return {title:'🚀 초고속 터보 ON!',detail:`속도 1.45배! ${names[st.target]} 깃발을 쓸어 담아!`,kind:'turbo'};
  if(st.round===11) return {title:'🏁 파이널 라운드!',detail:`마지막 30초! ${names[st.target]} 깃발로 역전해 봐!`,kind:'turbo'};
  return {title:`⚑ ${names[st.target]} 깃발 러시!`,detail:`${names[st.target]} 깃발마다 1점 · 최대한 많이 모아!`,kind:'normal'};
}

function App(){
  const view=useRef<HTMLDivElement>(null);
  const scene=useRef<ReturnType<typeof createScene>|null>(null);
  const sock=useRef<Socket|null>(null);
  const music=useRef<HTMLAudioElement|null>(null);
  const voice=useRef<HTMLAudioElement|null>(null);
  const identity=useRef('');
  const latest=useRef<State|null>(null);
  const round=useRef(-1);
  const muteRef=useRef(false);
  const steer=useRef(0);
  const drag=useRef<number|null>(null);
  const offset=useRef(0);
  const lastBeep=useRef(-1);
  const [state,setState]=useState<State|null>(null);
  const [name,setName]=useState('');
  const [code,setCode]=useState(new URLSearchParams(location.search).get('room')||'');
  const [error,setError]=useState('');
  const [connected,setConnected]=useState(false);
  const [announce,setAnnounce]=useState<Announcement|null>(null);
  const [gain,setGain]=useState('');
  const [stick,setStick]=useState({x:0,y:0});
  const [muted,setMuted]=useState(false);
  const [copied,setCopied]=useState(false);
  const [guideOpen,setGuideOpen]=useState(false);
  const [clock,setClock]=useState(0);

  function wakeAudio(){
    if(muteRef.current)return;
    try {audio??=new AudioContext();void audio.resume().catch(()=>{});} catch { /* sound remains optional */ }
    if(!music.current){
      const track=new Audio('/audio/planet-rush-theme.mp3');
      track.loop=true;track.preload='auto';track.volume=.3;
      music.current=track;
    }
    void music.current.play().catch(()=>{/* click sound button if autoplay was blocked */});
  }
  function toggleSound(){
    const next=!muteRef.current;
    muteRef.current=next;setMuted(next);
    if(next){music.current?.pause();voice.current?.pause();voice.current=null;}
    else wakeAudio();
  }

  // Only play a REAL pre-recorded voice clip, never a robotic browser voice.
  // Audio files are optional. Add fever.mp3, gold.mp3, turbo.mp3 and final.mp3
  // under public/audio/voice/ to activate these announcements automatically.
  async function playRecordedVoice(cue:'fever'|'gold'|'turbo'|'final'){
    if(muteRef.current)return;
    const url=`/audio/voice/${cue}.mp3`;
    try{
      const probe=await fetch(url,{method:'HEAD'});
      if(!probe.ok || !/^audio\//i.test(probe.headers.get('content-type')||''))return;
      if(muteRef.current)return;
      voice.current?.pause();
      const clip=new Audio(url);clip.volume=1;voice.current=clip;
      if(music.current)music.current.volume=.09;
      const restore=()=>{
        if(voice.current!==clip)return;
        voice.current=null;
        const st=latest.current;
        if(music.current)music.current.volume=st?.phase==='results'?.18:(st?.round??0)>=7?.36:.3;
      };
      clip.onended=restore;clip.onerror=restore;
      await clip.play();
    }catch{
      const st=latest.current;
      if(music.current&&voice.current===null)music.current.volume=(st?.round??0)>=7?.36:.3;
    }
  }

  useEffect(()=>{
    scene.current=createScene(view.current!);
    const s=io({autoConnect:true});sock.current=s;
    let bannerTimer:ReturnType<typeof setTimeout>|undefined;
    let gainTimer:ReturnType<typeof setTimeout>|undefined;
    const accept=(r:any)=>{
      if(r?.error){setError(r.error);sessionStorage.removeItem('pfr-session');return;}
      sessionStorage.setItem('pfr-session',r.token);
      identity.current=r.id;setState(r.state);latest.current=r.state;
      scene.current?.update(r.state,r.id);
      // First-time players read the rules before the host can start.
      if(r.state.phase==='lobby'){
        try{if(!localStorage.getItem('pfr-guide-v4'))setGuideOpen(true);}
        catch{setGuideOpen(true);}
      }
    };
    s.on('connect',()=>{
      setConnected(true);
      const token=sessionStorage.getItem('pfr-session');
      if(token)s.emit('enter',{token,name:'탐험가'},accept);
    });
    s.on('disconnect',()=>setConnected(false));
    s.on('state',(st:State)=>{
      offset.current=st.now?st.now-Date.now():0;
      latest.current=st;setState(st);scene.current?.update(st,identity.current);
      if(st.phase==='playing'&&round.current!==st.round){
        if(st.round===0)setGuideOpen(false);
        round.current=st.round;
        const notice=roundAnnouncement(st);
        setAnnounce(notice);
        if(bannerTimer)clearTimeout(bannerTimer);
        bannerTimer=setTimeout(()=>setAnnounce(null),notice.kind==='normal'?2300:4000);
        if(!muteRef.current){
          if(notice.kind==='fever'||notice.kind==='special'||notice.kind==='turbo')fanfare(notice.kind);
          else tone(675,.2);
          if(st.mode==='fever')void playRecordedVoice('fever');
          else if(st.mode==='special')void playRecordedVoice('gold');
          else if(st.round===10)void playRecordedVoice('turbo');
          else if(st.round===11)void playRecordedVoice('final');
        }
        if(music.current)music.current.volume=st.round>=7?.36:.3;
      }
      if(st.phase==='results'&&round.current!==99){
        round.current=99;if(!muteRef.current)tone(880,.6);
        if(music.current)music.current.volume=.18;
      }
    });
    s.on('pickup',(e:{n:number[];player:string;value:number})=>{
      scene.current?.burst(e.n);
      if(e.player===identity.current){
        setGain('+'+e.value);
        if(!muteRef.current)tone(e.value>1?1100:800,.13);
        if(gainTimer)clearTimeout(gainTimer);
        gainTimer=setTimeout(()=>setGain(''),650);
      }
    });
    const keys=new Set<string>();
    const kd=(e:KeyboardEvent)=>{if(e.target instanceof HTMLInputElement)return;if(['a','d','ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();keys.add(e.key);}};
    const ku=(e:KeyboardEvent)=>keys.delete(e.key);
    const reset=()=>{keys.clear();steer.current=0;setStick({x:0,y:0});};
    window.addEventListener('keydown',kd);window.addEventListener('keyup',ku);window.addEventListener('blur',reset);
    const timer=setInterval(()=>{
      const k=(keys.has('d')||keys.has('ArrowRight')?1:0)-(keys.has('a')||keys.has('ArrowLeft')?1:0);
      s.emit('input',k||steer.current);
      const st=latest.current;
      const left=st?Math.max(0,Math.ceil((st.ends-Date.now()-offset.current)/1000)):0;
      setClock(left);
      if(st?.phase==='playing'&&left<=3&&left>0&&lastBeep.current!==left){
        lastBeep.current=left;if(!muteRef.current)tone(450,.08);
      }
      if(left>3)lastBeep.current=-1;
    },50);
    (window as any).__pfr={accept};
    return()=>{
      clearInterval(timer);if(bannerTimer)clearTimeout(bannerTimer);if(gainTimer)clearTimeout(gainTimer);
      s.disconnect();scene.current?.dispose();music.current?.pause();voice.current?.pause();
      window.removeEventListener('keydown',kd);window.removeEventListener('keyup',ku);window.removeEventListener('blur',reset);
    };
  },[]);

  function enter(join:boolean){
    setError('');wakeAudio();
    sock.current?.emit('enter',{name:name.trim()||'탐험가',code:join?code:''},(r:any)=>(window as any).__pfr.accept(r));
  }
  function closeGuide(){
    setGuideOpen(false);
    try {localStorage.setItem('pfr-guide-v4','1');} catch { /* private mode */ }
  }
  const pointer=(e:React.PointerEvent)=>{
    const b=e.currentTarget.getBoundingClientRect(),x=e.clientX-b.left-b.width/2,y=e.clientY-b.top-b.height/2;
    const l=Math.max(1,Math.hypot(x,y)/44);
    setStick({x:x/l,y:y/l});steer.current=Math.max(-1,Math.min(1,x/44));
  };
  const ranking=[...(state?.players||[])].sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name));
  const me=state?.players.find(p=>p.id===identity.current);
  const playing=state?.phase==='playing';
  const speed=state?speedMultiplierForRound(state.round):1;

  return <main>
    <div className="world" ref={view}
      onPointerDown={e=>{if(!playing||e.pointerType!=='mouse')return;drag.current=e.clientX;e.currentTarget.setPointerCapture(e.pointerId);}}
      onPointerMove={e=>{if(drag.current!==null)steer.current=Math.max(-1,Math.min(1,(e.clientX-drag.current)/100));}}
      onPointerUp={()=>{drag.current=null;steer.current=0;}}
      onPointerCancel={()=>{drag.current=null;steer.current=0;}}/>
    <div className="grain"/>
    {playing&&speed>1&&<div className="speed-vignette" aria-hidden="true"/>}
    <header>
      <a className="brand" href="/">⚑ <span>PLANET<br/><b>FLAG RUSH</b></span></a>
      <div className="header-right">
        <span className={'connection '+(connected?'on':'')}>{connected?'● ONLINE':'● 연결 중'}</span>
        <button className="rules-button" onClick={()=>setGuideOpen(true)}>❔ 게임 방법</button>
        <button className="sound" aria-label="사운드 전환" onClick={toggleSound}>{muted?'♪ OFF':'♪ BGM ON'}</button>
      </div>
    </header>
    {!state&&<section className="welcome">
      <div className="eyebrow">SMALL PLANET. BIG RUSH.</div>
      <h1>달리고, 찾고,<br/><em>먼저 잡아라.</em></h1>
      <p>행성을 질주하며 깃발을 연속 획득하는 2–6인 스피드 배틀!<br/>색깔을 맞춰 많이 먹을수록 점수가 빠르게 올라갑니다.</p>
      <div className="entry"><label>나의 닉네임<input maxLength={16} value={name} onChange={e=>setName(e.target.value)} placeholder="탐험가 이름"/></label>
        <button className="primary" disabled={!connected} onClick={()=>enter(false)}>새로운 행성 만들기 <span>↗</span></button>
        <div className="join"><input aria-label="방 코드" maxLength={6} value={code} onChange={e=>setCode(e.target.value.toUpperCase())} placeholder="방 코드 입력"/><button disabled={!connected||!code} onClick={()=>enter(true)}>참가 →</button></div>
        {error&&<small role="alert">{error}</small>}
        <button className="learn-link" onClick={()=>setGuideOpen(true)}>시작 전에 게임 규칙 보기 →</button>
      </div>
      <div className="chips"><span>↻ 자동 달리기</span><span>⚑ 깃발 연속 획득</span><span>🚀 8라운드부터 가속!</span></div>
    </section>}
    {state?.phase==='lobby'&&<section className="panel lobby">
      <div className="eyebrow">READY FOR TAKEOFF</div>
      <h2>탐험가를 기다리는 중</h2>
      <p>친구에게 방 코드를 알려주세요.</p>
      <button className="room" onClick={async()=>{try{await navigator.clipboard.writeText(location.origin+'/?room='+state.code);setCopied(true);}catch{setError('초대 주소: '+location.origin+'/?room='+state.code);}}}>{state.code}<small>{copied?'초대 링크 복사 완료':'클릭해서 초대 링크 복사'}</small></button>
      <div className="roster">{state.players.map(p=><div key={p.id}><i style={{background:colors[p.avatar%5]}}>●</i><b>{p.name}</b><span>{p.id===state.host?'HOST':p.connected?'READY':'재접속 중'}</span></div>)}</div>
      <p>{state.players.length} / 6 탐험가 · 최소 2명</p>
      <div className="lobby-rules"><b>⚑ 목표 색상 깃발만 먹기!</b><span>일반 +1점 · 피버 +2~3점 · 황금 +5점</span><span>방향만 조작 · 8라운드부터 터보 가속</span><button onClick={()=>setGuideOpen(true)}>게임 방법 자세히 보기 →</button></div>
      {identity.current===state.host?<button className="primary" disabled={state.players.filter(p=>p.connected).length<2} onClick={()=>{wakeAudio();sock.current?.emit('start',{},(r:any)=>setError(r?.error||''));}}>출발하기 →</button>:<p>방장이 시작하면 함께 출발합니다.</p>}
      {error&&<small role="alert">{error}</small>}
    </section>}
    {state?.phase==='playing'&&<>
      <div className={'target '+state.mode}>
        <div className="round">ROUND {String(state.round+1).padStart(2,'0')} / 12 {speed>1&&<b className="turbo-label">🚀 {speed.toFixed(2)}× SPEED</b>}</div>
        <div className="objective"><i style={{background:state.mode==='special'?'#ffd65c':colors[state.target]}}>⚑</i><div>
          <small>{state.mode==='special'?'🌟 황금 깃발만 · 1개 +5점':state.mode==='fever'?'🔥 피버 타임 · 1개 +2~3점':'목표 색상 · 1개 +1점'}</small>
          <b>{state.mode==='special'?'황금 깃발':names[state.target]+' 깃발'}</b>
        </div><strong className={clock<=3?'urgent':''}>{clock}<small>SEC</small></strong></div>
      </div>
      {state.mode!=='normal'&&<div className={'event-hint '+state.mode}>{state.mode==='fever'?`🔥 피버! ${names[state.target]} 깃발 하나에 2~3점`:'🌟 황금 깃발만 먹으면 +5점!'}</div>}
      <aside className="scores"><small>LIVE RANKING</small>{ranking.map((p,i)=><div className={p.id===identity.current?'self':''} key={p.id}><span>{i+1}</span><b>{p.name}{!p.connected?' ···':''}</b><strong>{p.score}</strong></div>)}</aside>
      <div className="joystick" onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);pointer(e);}} onPointerMove={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))pointer(e);}} onPointerUp={()=>{setStick({x:0,y:0});steer.current=0;}} onPointerCancel={()=>{setStick({x:0,y:0});steer.current=0;}}><div style={{transform:`translate(${stick.x}px,${stick.y}px)`}}>↔</div></div>
      <div className="steerhint">STEER ONLY · KEEP RUNNING</div>
      <div className="my-score"><small>MY SCORE</small><b>{me?.score||0}</b></div>
      {announce&&<div className={'event-banner '+announce.kind} key={state.round}><strong>{announce.title}</strong><span>{announce.detail}</span></div>}
      {gain&&<div className="gain">{gain}</div>}
      {clock<=3&&clock>0&&<div className="countdown">{clock}</div>}
    </>}
    {state?.phase==='results'&&<section className="panel results"><div className="eyebrow">THAT WAS A GOOD RUN</div><div className="trophy">♛</div><h2>{ranking[0]?.name} {ranking.filter(p=>p.score===ranking[0]?.score).length>1?'외 공동 우승!':'우승!'}</h2><p>작은 행성에서 펼쳐진 커다란 모험</p>{ranking.map((p,i)=><div className="result-row" key={p.id}><span>{ranking.findIndex(x=>x.score===p.score)+1}</span><b>{p.name}</b><strong>{p.score} <small>PTS</small></strong></div>)}{identity.current===state.host?<button className="primary" onClick={()=>{wakeAudio();sock.current?.emit('start',{},(r:any)=>setError(r?.error||''));}}>한 번 더 달리기 ↻</button>:<p>방장의 재시작을 기다리고 있어요.</p>}{error&&<small>{error}</small>}</section>}
    {guideOpen&&<div className="guide-backdrop" role="presentation" onPointerDown={e=>{if(e.target===e.currentTarget)closeGuide();}}><section className="guide-card" role="dialog" aria-modal="true" aria-label="게임 방법">
      <div className="eyebrow">HOW TO PLAY · 2–6 PLAYERS</div>
      <h2>⚑ 게임 방법</h2>
      <div className="guide-steps">
        <div><strong>01 · 멈추지 말고 달려!</strong><p>캐릭터는 자동으로 달립니다. PC는 A / D 또는 ← →, 마우스 드래그로 방향을 바꾸고 모바일에서는 왼쪽 조이스틱을 사용하세요.</p></div>
        <div><strong>02 · 표시된 색 깃발을 연속 획득!</strong><p>화면 위에 뜬 목표 색의 깃발만 점수를 줍니다. 일반 라운드는 1개당 <b>+1점</b>, 제한 시간은 <b>30초</b>예요.</p></div>
        <div className="fever"><strong>🔥 피버 타임</strong><p>목표 색 깃발을 먹을 때마다 <b>+2~3점</b>! 20초 동안 연속으로 모으세요.</p></div>
        <div className="gold"><strong>🌟 황금 깃발 러시</strong><p><b>금색 깃발만</b> 점수가 됩니다. 1개당 <b>+5점</b>! 20초 동안 역전을 노리세요.</p></div>
        <div className="turbo"><strong>🚀 후반부 터보</strong><p><b>8라운드부터 속도 1.3배</b>, 11~12라운드는 <b>1.45배</b>! 총 12라운드 종료 후 점수가 가장 높은 사람이 우승합니다.</p></div>
      </div>
      <button className="primary" onClick={closeGuide}>이해했어요! 출발 준비 →</button>
    </section></div>}
    {!connected&&state&&<div className="reconnecting">연결 복구 중 · 30초 이내 재접속하면 이어집니다</div>}
    <footer>EXPLORE A LITTLE. RUSH A LOT.</footer>
    <div className="rotate">↻<br/>가로로 돌리면 더 넓게 볼 수 있어요</div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
