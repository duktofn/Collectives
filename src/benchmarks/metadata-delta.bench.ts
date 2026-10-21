import { bench, describe } from "vitest";
import type { Collection } from "../types";
import { applyCollectionDelta, materializeCollection, replaceMetadataSnapshot } from "../features/collections/metadataCache";

const collection: Collection={id:"bench",schemaVersion:1,name:"Bench",createdAt:"",updatedAt:"",entries:Array.from({length:10000},(_,index)=>({type:"file",id:`entry-${index}`,path:`${index}.md`}))};
const snapshot=replaceMetadataSnapshot(collection,1);
const delta={collectionId:"bench",revision:2,mutationId:"one",origin:"bench",changes:[{kind:"updated",entryId:"entry-0",entry:{id:"entry-0",parentId:null,entryType:"file",path:"changed.md",sortOrder:0}}]};

describe("10k metadata projection (algorithm proxy, not native latency)",()=>{
  bench("full snapshot rebuild",()=>{
    const full=replaceMetadataSnapshot({...collection,entries:collection.entries.map((entry,index)=>index===0?{...entry,path:"changed.md"}:entry)},2);
    materializeCollection(full,collection);
  });
  bench("one-entry incremental projection",()=>{
    materializeCollection(applyCollectionDelta(snapshot,delta).state,collection);
  });
});
