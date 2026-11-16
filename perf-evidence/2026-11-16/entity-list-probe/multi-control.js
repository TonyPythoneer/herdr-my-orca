import { View, div } from "gpui-kit";
import { VirtualListScrollHandle, v_virtual_list } from "gpui-base";
class Row extends View {
  init({owner,index}, cx) { this.owner=owner; this.index=index; this.handles=Array.from({length:3},()=>cx.focus_handle()); owner.handles[index]=this.handles; }
  render() {
    this.owner.seen.add(this.index);
    return div().h(80).track_focus(this.handles[0]).tab_index(0).child(`row ${this.index}`)
      .children([1,2].map(i=>div().track_focus(this.handles[i]).tab_index(0).on_click(()=>{}).child(`control ${i}`)));
  }
}
export default class Probe extends View {
  init(_,cx) {
    this.handles=[]; this.seen=new Set(); this.target=null; this.cursor=[988,0]; this.results=[];
    this.rows=Array.from({length:1000},(_,index)=>cx.new(Row,{owner:this,index}));
    this.scroll=VirtualListScrollHandle.new(); this.scroll.scroll_to_item(988);
    cx.bind_keys([{keystroke:"tab",action:"probe.next",context:"MultiProbe"},{keystroke:"shift-tab",action:"probe.previous",context:"MultiProbe"}]);
    let phase=0;
    cx.timer.every(100,cx=>{
      if(this.target && this.seen.has(this.target[0])) { this.cursor=this.target; this.target=null; this.handles[this.cursor[0]][this.cursor[1]].focus(); }
      if(phase===0 && this.seen.has(988)) { this.handles[988][0].focus(); phase=1; }
      else if(phase===1 && !this.target) {
        const [r,c]=this.cursor;
        if(!this.handles[r][c].is_focused()) throw new Error(`lost focus ${r}:${c}`);
        this.results.push(`${r}:${c}`);
        if(this.results.length===19) { console.log("MULTI final",JSON.stringify(this.results)); phase=2; }
        else window.dispatch_action(this.results.length<=9 ? "probe.previous" : "probe.next");
      }
    });
  }
  move(direction,cx) {
    const [r,c]=this.cursor, next=c+direction;
    if(next>=0 && next<3) { direction>0 ? window.focus_next() : window.focus_prev(); this.cursor=[r,next]; }
    else { this.target=[r+direction,direction>0?0:2]; this.scroll.scroll_to_item(this.target[0]); cx.notify(); }
  }
  render() { return div().size_full().key_context("MultiProbe")
    .on_action("probe.previous",(_e,cx)=>{cx.stop_propagation();this.move(-1,cx);})
    .on_action("probe.next",(_e,cx)=>{cx.stop_propagation();this.move(1,cx);})
    .child(v_virtual_list("multi",1000,80,i=>String(i),range=>{const rows=[];for(let i=range.start;i<range.end;i++)rows.push(div().child(this.rows[i]));return rows;}).track_scroll(this.scroll)); }
  close() {for(const row of this.rows)row.release();for(const hs of this.handles)for(const h of hs)h.release();this.scroll.release();}
}
