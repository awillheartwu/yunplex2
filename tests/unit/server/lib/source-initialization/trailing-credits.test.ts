import { expect, it } from 'vitest'
import { matchingPreset } from '~~/shared/initialization-matching'
import { titleParts } from '~~/server/lib/source-initialization/matching-normalization'
import { buildInitializationPlans } from '~~/server/lib/source-initialization/candidate-engine'
const config = matchingPreset('balanced')
const song = {id:1,name:'时过境迁',no:1,dt:180000,disc:'1',artists:[{name:'野岸刊'},{name:'罗小黑'}],album:{id:1,name:'树影下流动的时间',picUrl:'',publishTime:0}}
const media = {ratingKey:'candidate',title:'时过境迁feat.罗小黑',grandparentTitle:'野岸刊&罗小黑',parentTitle:song.album.name,index:1,duration:180000,Media:[{Part:[{file:'/music/song.flac'}]}]}
it('recognizes attached CJK, spaced Latin and bracketed explicit credits', () => {
  for (const title of ['时过境迁feat.罗小黑','时过境迁 ft.罗小黑','时过境迁 (feat.罗小黑)','时过境迁 featuring 罗小黑']) {
    expect(titleParts(title,config)).toMatchObject({core:'时过境迁',contributors:['罗小黑']})
  }
  expect(titleParts('Signal feat. Guest',config)).toMatchObject({core:'signal',contributors:['Guest']})
  expect(titleParts('Signal ft Guest',config)).toMatchObject({core:'signal',contributors:['Guest']})
})
it('promotes only corroborated matching credits and preserves version and artist checks', () => {
  const run = (patch = {}) => buildInitializationPlans({songs:[song],tracks:[{...media,...patch}],bindings:new Map(),matching:config})[0]!
  expect(run().tier).toBe('high_confidence')
  expect(run().decision).toBe('defer')
  expect(run({title:'时过境迁feat.陌生人'}).tier).not.toBe('high_confidence')
  expect(run({title:'时过境迁feat.罗小黑 (Live)'}).tier).not.toBe('high_confidence')
  expect(run({title:'时过境迁feat.罗小黑 - Remix'}).tier).not.toBe('high_confidence')
  expect(run({duration:230000}).tier).not.toBe('high_confidence')
})
it('does not strip ordinary title words or unseparated Latin substrings', () => {
  for (const title of ['With You','Defeat. Guest','Defeaturing Guest','Signalfeat.Guest','Left Behind']) {
    expect(titleParts(title,config).contributors).toEqual([])
  }
})
