// @vitest-environment node
import { beforeEach, expect, it } from 'vitest';
import { catalog } from '@/data/mock/catalog';
import { getStore, resetStore } from '@/data/mock/store';
beforeEach(resetStore);
it('link admission rejects unsafe schemes and returns only nullable local metadata',async()=>{
 const owner=getStore().users.find(u=>u.role==='customer')!.id;
 expect(await catalog.checkSource(owner,{kind:'link',url:'ftp://instagram.com/reel/ABC/'})).toEqual({ok:false,reason:'unsupported-site'});
 expect(await catalog.checkSource(owner,{kind:'link',url:'https://instagram.com/reel/ABC/?utm=1'})).toEqual({ok:true,seconds:null,format:null,shots:null});
});
