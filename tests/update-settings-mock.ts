export class Setting {
 el: HTMLElement;
 constructor(parent:HTMLElement){this.el=document.createElement('div');parent.append(this.el);}
 setName(s:string){const e=document.createElement('label');e.textContent=s;this.el.append(e);return this;}
 setDesc(s:string){const e=document.createElement('p');e.textContent=s;this.el.append(e);return this;}
 addToggle(fn:any){const e=document.createElement('input');e.type='checkbox';this.el.append(e);const c:any={setValue(v:boolean){e.checked=v;return c;},setDisabled(v:boolean){e.disabled=v;return c;},onChange(cb:any){e.onchange=()=>cb(e.checked);return c;}};fn(c);return this;}
 addButton(fn:any){const e=document.createElement('button');this.el.append(e);const c:any={setButtonText(v:string){e.textContent=v;return c;},setDisabled(v:boolean){e.disabled=v;return c;},setCta(){return c;},onClick(cb:any){e.onclick=cb;return c;}};fn(c);return this;}
}
