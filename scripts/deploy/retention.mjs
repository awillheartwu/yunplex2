// Remove only this project's old SHA tags. Container images and the previous
// deployment remain available, even when they are older than the newest three.
export async function pruneImages(run, protectedImages = []) {
  await run(['image', 'prune', '--force', '--filter', 'label=reyunplex.build-cache=true', '--filter', 'until=168h'])
  const ids = (await run(['image', 'ls', 'reyunplex', '--quiet', '--no-trunc'])).split(/\s+/).filter(Boolean)
  if (!ids.length) return
  const images = JSON.parse(await run(['image', 'inspect', ...new Set(ids)]))
  const containers = (await run(['ps', '-aq'])).split(/\s+/).filter(Boolean)
  const used = containers.length
    ? (await run(['container', 'inspect', ...containers, '--format', '{{.Image}}'])).split(/\s+/) : []
  const protectedIds = new Set([...protectedImages, ...used])
  const candidates = images
    .filter(image => image.RepoTags?.some(tag => /^reyunplex:[a-f0-9]{40}$/.test(tag)))
    .sort((a, b) => Date.parse(b.Created) - Date.parse(a.Created))
  for (const image of candidates.slice(3)) {
    if (protectedIds.has(image.Id)) continue
    for (const tag of image.RepoTags.filter(tag => /^reyunplex:[a-f0-9]{40}$/.test(tag))) {
      await run(['image', 'rm', tag])
    }
  }
}
