// Synthetic cooking data. No Notion export or personal task content is used.
export const zone = 'America/Denver';
const at = (time: string, day = '26') => `2026-11-${day}T${time}:00-07:00`;
export const seed = [
  { file: 'Defrost turkey', Step: 'Defrost', Dish: 'Turkey', start: at('09:00','22'), end: at('18:00','25') },
  { file: 'Prepare stock', Step: 'Prepare stock', Dish: 'Gravy', 'Active Chef':'Alex', start: at('14:00'),end:at('15:00') },
  { file: 'Peel potatoes', Step:'Peel potatoes',Dish:'Potato gratin','Active Chef':'Maya',start:at('15:00'),end:at('15:30') },
  { file: 'Warm oil',Step:'Warm oil',Dish:'Turkey','Active Chef':'Alex',start:at('15:30'),end:at('16:00') },
  { file: 'First bake',Step:'First bake',Dish:'Potato gratin','Oven Temp':'400','Active Chef':'Maya',start:at('16:00'),end:at('16:30'),'Blocked by':['[[Tasks/Peel potatoes]]'] },
  { file:'Roast turkey',Step:'Roast',Dish:'Turkey','Oven Temp':'375','Active Chef':'Maya',start:at('16:00'),end:at('17:30'),'Blocked by':['[[Tasks/Warm oil]]','[[Tasks/Defrost turkey]]'] },
  { file:'Second bake',Step:'Second bake',Dish:'Potato gratin','Oven Temp':'400',start:at('16:45'),end:at('17:15'),'Blocked by':['[[Tasks/First bake]]'] },
  { file:'Bake carrots',Step:'Bake',Dish:'Rosemary carrots','Oven Temp':'400','Active Chef':'Alex',start:at('17:00'),end:at('17:45') },
  { file:'Final bake',Step:'Final bake',Dish:'Potato gratin','Oven Temp':'400',start:at('17:25'),end:at('17:55'),'Blocked by':['[[Tasks/Second bake]]'] },
  { file:'Turkey rest',Step:'Rest',Dish:'Turkey',start:at('17:30'),end:at('17:55'),'Blocked by':['[[Tasks/Roast turkey]]'] },
  { file:'Gratin rest',Step:'Rest',Dish:'Potato gratin',start:at('17:55'),end:at('18:00'),'Blocked by':['[[Tasks/Final bake]]'] },
  { file:'Serve dinner',Step:'Serve dinner',start:at('18:00'),end:at('18:30'),'Blocked by':['[[Tasks/Gratin rest]]','[[Tasks/Turkey rest]]','[[Tasks/Bake carrots]]'] },
].map(({file,...frontmatter})=>({path:`Tasks/${file}.md`,frontmatter}));

const common = {startDateProp:'note.start',endDateProp:'note.end',labelProp:'note.Step',dependencyProp:'note.Blocked by',colorProp:'note.Dish',timeZone:zone,snapMinutes:5,tickMinutes:15,scaleId:'day',oneTaskPerRow:true,showTable:false,showArrows:true,showToday:false,locked:true,initialScroll:'end',focusDate:'2026-11-26T16:00',taskFolder:'Tasks',collapsedGroups:[]};
export const configs: Record<string,any> = {
  Timeline:{...common,barDisplayProp1:'note.Oven Temp',barDisplayProp2:'note.Dish'},
  Oven:{...common,barDisplayProp1:'note.Oven Temp',requiredNewTaskProps:['Oven Temp']},
  Chef:{...common,groupOrder:['Alex','Maya'],requiredNewTaskProps:['Active Chef']},
  Month:{...common,scaleId:'month',initialScroll:'start'},
};
