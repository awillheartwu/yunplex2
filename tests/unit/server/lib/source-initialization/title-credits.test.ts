import { expect, it } from 'vitest'
import { matchingPreset } from '~~/shared/initialization-matching'
import { titleParts, versionEvidence } from '~~/server/lib/source-initialization/matching-normalization'
import { buildInitializationPlans } from '~~/server/lib/source-initialization/candidate-engine'
const config = matchingPreset('balanced')
it('keeps guest artists in mixed production annotations regardless of clause order', () => {
  for (const title of ['rain（prod.bycon，feat snow）','rain (feat snow; prod. by con)','rain (prod.bycon, feat. A, B)']) {
    const parsed = titleParts(title,config)
    expect(parsed.core).toBe('rain')
    expect(parsed.contributors).toEqual(title.includes('A, B')?['A, B']:['snow'])
    expect(parsed.contextRemoved).toBe(true)
  }
  expect(titleParts('rain（prod.bycon，feat snow）',{...config,ignoreContextNotes:false}).core).not.toBe('rain')
  expect(titleParts('rain (prod.bycon, unknown credit)',config).core).not.toBe('rain')
})
it('recognizes explicit credits, fullwidth typography and artist names that contain version words', () => {
  for (const note of ['w/ Guest','with Guest','Vocal: Guest','演唱：Guest','人声：Guest','ｆｅａｔ．Ｇｕｅｓｔ']) {
    expect(titleParts(`Song (${note})`,config)).toMatchObject({core:'song',contributors:['Guest']})
  }
  expect(titleParts('Song (feat. Live)',config)).toMatchObject({core:'song',contributors:['Live'],versions:{}})
  for (const title of ['With You','Love with Your Life','Rain (Production Love)','Rain (Best Plan)']) expect(titleParts(title,config).contributors).toEqual([])
})
it('does not erase explicit edition or video evidence', () => {
  for (const note of ['TV edit','extended mix','club mix','dub mix','music clip','music video','Live版','Cover田馥甄']) {
    const parsed = titleParts(`Song (${note})`,config)
    expect(Object.keys(parsed.versions).length).toBeGreaterThan(0)
    const comparison = versionEvidence(titleParts('Song',config),parsed,config)
    expect(comparison.conflicts.length+comparison.review.length).toBeGreaterThan(0)
  }
})
it('does not recommend a hidden unlisted collaborator from a production note', () => {
  const song={id:1,name:'rain',no:1,dt:180000,disc:'1',artists:[{name:'con'}],album:{id:1,name:'Album',picUrl:'',publishTime:0}}
  const track={ratingKey:'1',title:'rain（prod.bycon，feat snow）',grandparentTitle:'con',parentTitle:'Album',index:1,duration:180000,Media:[{Part:[{file:'/music/rain.flac'}]}]}
  const run=(artists: typeof song.artists)=>buildInitializationPlans({songs:[{...song,artists}],tracks:[track],bindings:new Map(),matching:config})[0]!
  expect(run(song.artists).tier).not.toBe('high_confidence')
  expect(run([...song.artists,{name:'snow'}]).tier).toBe('high_confidence')
})
