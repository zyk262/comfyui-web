import React from 'react';
import {AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const smooth = Easing.bezier(0.22, 1, 0.36, 1);
const colors = ['#a9e9ea', '#dabaff', '#ffc8df'];

// All movement is derived from the timeline. The same scene runs in Studio and Player.
const CardBack = React.memo(({accent}: {accent: string}) => <svg viewBox="0 0 160 252" width="100%" height="100%" style={{display: 'block'}}>
  <rect x="1" y="1" width="158" height="250" rx="14" fill="#201d38" stroke={accent} strokeWidth="1.4"/>
  <rect x="7" y="7" width="146" height="238" rx="10" fill="#35304e" stroke={accent} strokeOpacity=".3"/>
  <path d="M12 42 Q80 6 148 42 L148 211 Q80 246 12 211Z" fill="#28243e"/>
  <path d="M17 64V28H48 M112 28H143V64 M17 188V224H48 M112 224H143V188" fill="none" stroke={accent} strokeWidth=".8"/>
  <path d="M80 23L86 32L80 41L74 32Z M80 211L86 220L80 229L74 220Z" fill={accent} opacity=".75"/>
  <ellipse cx="80" cy="126" rx="51" ry="68" fill="none" stroke={accent} strokeOpacity=".45" strokeWidth=".7"/>
  <ellipse cx="80" cy="126" rx="42" ry="55" fill="none" stroke={accent} strokeOpacity=".25" strokeWidth=".6"/>
  <path d="M80 63L116 126L80 189L44 126Z" fill="none" stroke={accent} strokeWidth=".8" opacity=".7"/>
  <path d="M89 91 A31 31 0 1 0 105 143 A32 32 0 0 1 89 91" fill={accent}/>
  <path d="M103 103L106 113L116 116L106 119L103 129L100 119L90 116L100 113Z" fill="#fff0f8"/>
  <path d="M34 75L49 59L61 75 M99 176L111 191L128 175" fill="none" stroke={accent} opacity=".45"/>
  {[ [34,75], [49,59], [61,75], [99,176], [111,191], [128,175], [26,135], [135,99] ].map(([x,y],i)=><circle key={i} cx={x} cy={y} r={i%3===0?2:1.2} fill={accent}/>)}
  <text x="80" y="204" textAnchor="middle" fill={accent} opacity=".8" fontSize="5.8" letterSpacing="3" fontFamily="Georgia, serif">YUKI ATELIER</text>
</svg>);

const Deck: React.FC<{seconds: number}> = ({seconds}) => {
  const reveal = interpolate(seconds, [0, 1.4], [0, 1], {...clamp, easing: smooth});
  const opacity = interpolate(seconds, [0, .7, 7.1, 8.4], [0, 1, 1, 0], clamp);
  return <AbsoluteFill style={{opacity, perspective: 1100}}>
    {Array.from({length: 19}, (_, i) => {
      const x = ((i * 86 - seconds * 43 + 860) % 1634 + 1634) % 1634 - 860;
      const edge = Math.abs(x) / 650;
      const picked = i >= 1 && i <= 3 && seconds >= i * 2;
      return <div key={i} style={{position: 'absolute', left: 394, top: 130,
        width: 112, height: 176, opacity: picked ? 0 : interpolate(edge, [.58, 1.1], [1, 0], clamp),
        transform: `translate3d(${x * reveal}px,${edge * edge * 70 + (1-reveal)*65}px,${-edge*130}px) rotateX(10deg) rotateY(${x / 20}deg) rotateZ(${x/75}deg) scale(${.7 + .3*reveal})`,
        boxShadow: '0 16px 26px #05031480', borderRadius: 12}}><CardBack accent={colors[i % 3]}/></div>;
    })}
  </AbsoluteFill>;
};

const DrawnCard: React.FC<{index: number; seconds: number; frame: number; fps: number}> = ({index, seconds, frame, fps}) => {
  const start = (index + 1) * 2;
  const age = seconds - start;
  if (age < 0) return null;
  const lift = interpolate(age, [0, .48], [0, 1], {...clamp, easing: smooth});
  const land = spring({frame: Math.max(0, frame-(start+.48)*fps), fps, config: {damping: 19, stiffness: 90, mass: 1.15}});
  const targetX = (index-1)*265;
  const x = land * targetX;
  const y = interpolate(lift, [0,1], [218,106]) + land*206;
  const scale = interpolate(lift, [0,1], [.7,1.08]) - land*.08;
  const tilt = (1-land)*(index===1?8:(index-1)*-18) + Math.sin(age*2.2)*.7*land;
  const shine = interpolate(age,[0,.4,.9,1.7],[0,.9,.6,0],clamp);
  const aura = interpolate(age,[.2,.8,1.9],[0,.55,.12],clamp);
  return <>
    <div style={{position: 'absolute', left: 450+x-130, top: y-154, width:260, height:308,
      background: `radial-gradient(ellipse,${colors[index]}40,transparent 68%)`, opacity:aura}}/>
    <div style={{position:'absolute',left:370,top:-126,width:160,height:252,transformOrigin:'50% 50%',
      transform:`translate3d(${x}px,${y}px,0) rotateY(${(1-land)*-22}deg) rotateZ(${tilt}deg) scale(${scale})`,
      borderRadius:14,boxShadow:`0 24px 48px #06041599,0 0 ${20+shine*25}px ${colors[index]}${Math.round((.18+shine*.4)*255).toString(16).padStart(2,'0')}`}}>
      <CardBack accent={colors[index]}/>
      <div style={{position:'absolute',inset:1,borderRadius:14,overflow:'hidden',opacity:shine}}>
        <div style={{position:'absolute',width:70,height:400,top:-70,
          left:interpolate(age,[.15,1.25],[-160,260],clamp),transform:'rotate(25deg)',
          background:'linear-gradient(90deg,transparent,#fff6,transparent)'}}/>
      </div>
    </div>
    {Array.from({length:14},(_,i)=>{
      const travel = interpolate(age,[.1,1.5],[0,1],clamp);
      const angle = i*2.399;
      return <div key={i} style={{position:'absolute',width:i%3===0?5:3,height:i%3===0?5:3,borderRadius:'50%',
        left:450+x+Math.cos(angle)*travel*130,top:y+Math.sin(angle)*travel*115,
        background:colors[index],opacity:interpolate(age,[.05,.4,1.55],[0,.8,0],clamp),
        transform:`scale(${1-travel*.6})`,boxShadow:`0 0 9px ${colors[index]}`}}/>;
    })}
  </>;
};

export const GachaDraw: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  // Stretch the complete choreography to 15 seconds, including spring motion.
  const sceneFrame = frame / 1.5;
  const seconds = sceneFrame/fps;
  const ringReveal = interpolate(seconds,[0,1.8,7.6,9],[0,1,1,.25],clamp);
  const settle = interpolate(seconds,[7.6,9.3],[0,1],{...clamp,easing:smooth});
  return <AbsoluteFill style={{overflow:'hidden',perspective:1200}}>
    <AbsoluteFill style={{background:'radial-gradient(ellipse at 50% 48%,#a576cf20,transparent 65%)'}}/>
    {Array.from({length:36},(_,i)=>{
      const x=(i*173.37)%900;
      const y=((i*73.13-seconds*(5+i%5))+660)%660;
      const glow=.2+.3*(1+Math.sin(seconds*1.6+i))/2;
      return <div key={i} style={{position:'absolute',left:x,top:y,width:i%5===0?3:1.5,height:i%5===0?3:1.5,
        borderRadius:'50%',background:colors[i%3],opacity:glow}}/>;
    })}
    <svg width="900" height="600" style={{position:'absolute',opacity:ringReveal}}>
      <g transform={`translate(450 254) rotate(${seconds*5}) scale(1 .4)`} fill="none" stroke="#dcc1fb">
        <circle r="300" strokeOpacity=".13" strokeWidth="1"/>
        <circle r="270" strokeOpacity=".22" strokeDasharray="1 18" strokeWidth="2"/>
        <circle r="248" strokeOpacity=".13" strokeWidth="1"/>
        {[0,60,120,180,240,300].map(a=><path key={a} transform={`rotate(${a})`} d="M0 -312L6 -300L0 -288L-6 -300Z" fill="#d4b5ed" fillOpacity=".4" stroke="none"/>)}
      </g>
    </svg>
    <Deck seconds={seconds}/>
    {[0,1,2].map(index=><DrawnCard key={index} index={index} seconds={seconds} frame={sceneFrame} fps={fps}/>)}
    <svg width="900" height="600" style={{position:'absolute',opacity:settle}}>
      <path d="M166 494H390 M510 494H734" stroke="#d5b6ef" strokeOpacity=".22"/>
      <path d="M450 480L454 490L464 494L454 498L450 508L446 498L436 494L446 490Z" fill="#edc8e5"/>
      <circle cx="410" cy="494" r="2" fill="#b9e9e8"/><circle cx="490" cy="494" r="2" fill="#b9e9e8"/>
    </svg>
  </AbsoluteFill>;
};
