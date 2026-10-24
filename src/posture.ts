import { Quaternion, Vector3, type AnimationGroup, type TransformNode } from './babylon.ts';
import type { Animation } from '@babylonjs/core/Animations/animation';

/** Bake only the ready/strafe curves on this rig. Source containers and action clips stay intact. */
export function correctReadyPosture(groups:Map<string,AnimationGroup>,modelParent:TransformNode){
  const report={clips:[] as string[],frames:0,pitchBefore:[Infinity,-Infinity],pitchAfter:[Infinity,-Infinity]};
  const rotate=(v:Vector3,q:Quaternion)=>v.rotateByQuaternionToRef(q,Vector3.Zero()).normalize();
  const angle=(v:Vector3)=>Math.atan2(v.y,Math.hypot(v.x,v.z))*180/Math.PI;
  const poseGroups=new Set(['idle','walk_forward','walk_back','walk_left','walk_right'].map(name=>groups.get(name)).filter((g):g is AnimationGroup=>!!g));
  for(const group of poseGroups){
    const tracks=new Map<TransformNode,Animation>();
    for(const item of group.targetedAnimations)if(item.animation.targetProperty==='rotationQuaternion')tracks.set(item.target,item.animation);
    const nodes=[...tracks.keys()],name=(node:TransformNode)=>node.name.replace(/^p\d+_/,'').toLowerCase();
    const waist=nodes.find(n=>name(n)==='spine02'),head=nodes.find(n=>name(n)==='head');
    const front=head?.getChildren().find(n=>name(n as TransformNode)==='headfront') as TransformNode|undefined;
    if(!waist||!head||!front)continue;
    const rest=new Map<TransformNode,Quaternion>();
    const restRotation=(node:TransformNode)=>{
      let q=rest.get(node);if(!q){q=node.rotationQuaternion?.clone()||Quaternion.FromEulerVector(node.rotation);rest.set(node,q);}return q;
    };
    const sample=(node:TransformNode,frame:number):Quaternion=>{
      const keys=tracks.get(node)?.getKeys();if(!keys?.length)return restRotation(node);
      let lo=0,hi=keys.length-1;while(lo<hi){const mid=(lo+hi)>>1;if(keys[mid].frame<frame)lo=mid+1;else hi=mid;}
      const right=keys[lo],left=keys[Math.max(0,lo-1)];
      return Quaternion.Slerp(left.value,right.value,right.frame===left.frame?0:Math.max(0,Math.min(1,(frame-left.frame)/(right.frame-left.frame))));
    };
    const world=(node:TransformNode|null,frame:number):Quaternion=>{
      if(!node||node===modelParent)return Quaternion.Identity();
      return world(node.parent as TransformNode|null,frame).multiply(sample(node,frame)).normalize();
    };
    const localCorrection=(node:TransformNode,frame:number,from:Vector3,to:Vector3)=>{
      const parent=world(node.parent as TransformNode|null,frame),delta=Quaternion.Identity();Quaternion.FromUnitVectorsToRef(from,to,delta);
      return parent.conjugate().multiply(delta).multiply(parent).multiply(sample(node,frame)).normalize();
    };
    const waistKeys=tracks.get(waist)!.getKeys(),headKeys=tracks.get(head)!.getKeys();
    const originalPitch=new Map(headKeys.map(key=>[key.frame,angle(rotate(front.position,world(head,key.frame)))]));
    const correctedWaist=waistKeys.map(key=>{
      const up=rotate(Vector3.Up(),world(waist,key.frame)),lean=Math.acos(Math.max(-1,Math.min(1,up.y)));
      // Keep a light athletic lean and the original sway; legs/root grounding do not change.
      const limit=10*Math.PI/180,target=lean>limit?new Vector3(up.x,0,up.z).normalize().scale(Math.sin(limit)).add(Vector3.Up().scale(Math.cos(limit))):up;
      return {...key,value:localCorrection(waist,key.frame,up,target),inTangent:undefined,outTangent:undefined};
    });
    const waistCurve=tracks.get(waist)!.clone();waistCurve.setKeys(correctedWaist);tracks.set(waist,waistCurve);
    const correctedHead=headKeys.map(key=>{
      const forward=rotate(front.position,world(head,key.frame));
      // Face the gameplay heading instead of the floor/guard hand. Small sway keeps the idle alive.
      const phase=(key.frame-group.from)/Math.max(1,group.to-group.from)*Math.PI*2,yaw=Math.sin(phase)*.025,pitch=Math.sin(phase)*.012;
      const target=new Vector3(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch));
      const q=localCorrection(head,key.frame,forward,target),after=rotate(front.position,world(head.parent as TransformNode,key.frame).multiply(q));
      const before=originalPitch.get(key.frame)!,fixed=angle(after);report.pitchBefore[0]=Math.min(report.pitchBefore[0],before);report.pitchBefore[1]=Math.max(report.pitchBefore[1],before);report.pitchAfter[0]=Math.min(report.pitchAfter[0],fixed);report.pitchAfter[1]=Math.max(report.pitchAfter[1],fixed);report.frames++;
      return {...key,value:q,inTangent:undefined,outTangent:undefined};
    });
    const headCurve=tracks.get(head)!.clone();headCurve.setKeys(correctedHead);
    for(const item of group.targetedAnimations){if(item.target===waist&&item.animation.targetProperty==='rotationQuaternion')item.animation=waistCurve;if(item.target===head&&item.animation.targetProperty==='rotationQuaternion')item.animation=headCurve;}
    report.clips.push(group.name.replace(/^p\d+_/,''));
  }
  return {...report,pitchBefore:report.frames?report.pitchBefore:null,pitchAfter:report.frames?report.pitchAfter:null};
}
