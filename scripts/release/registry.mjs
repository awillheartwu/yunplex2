const accept = 'application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json'

// Registry reads distinguish missing tags from authentication or network errors.
export function registry(image, username, password) {
  const name = image.slice('ghcr.io/'.length)
  async function request(path, missingAllowed = false) {
    const url = new URL('https://ghcr.io/token')
    url.searchParams.set('service', 'ghcr.io')
    url.searchParams.set('scope', `repository:${name}:pull,push`)
    const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
    const auth = await fetch(url, { headers: { authorization }, signal: AbortSignal.timeout(30_000) })
    if (!auth.ok) throw new Error(`GHCR authentication failed (HTTP ${auth.status})`)
    const { token } = await auth.json()
    if (!token) throw new Error('GHCR did not return a registry token')
    const result = await fetch(`https://ghcr.io/v2/${name}/${path}`, {
      headers: { authorization: `Bearer ${token}`, accept }, signal: AbortSignal.timeout(30_000),
    })
    if (missingAllowed && result.status === 404) return null
    if (!result.ok) throw new Error(`GHCR read failed (HTTP ${result.status}); no missing-tag fallback was used`)
    return { value: await result.json(), digest: result.headers.get('docker-content-digest') }
  }
  return {
    async manifest(tag) {
      const result = await request(`manifests/${tag}`, true)
      if (!result) return null
      const imageId = result.value.config?.digest
      if (!/^sha256:[a-f0-9]{64}$/.test(imageId ?? '') || !/^sha256:[a-f0-9]{64}$/.test(result.digest ?? '')) {
        throw new Error(`GHCR ${tag} is not a single-architecture image manifest with a digest`)
      }
      return { imageId, digest: result.digest }
    },
    async version(manifest) {
      const result = await request(`blobs/${manifest.imageId}`)
      return result.value.config?.Labels?.['org.opencontainers.image.version']
    },
  }
}

export function compareVersions(left, right) {
  const a = left.split('.').map(BigInt)
  const b = right.split('.').map(BigInt)
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1
  }
  return 0
}
