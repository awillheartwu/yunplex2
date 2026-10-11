#!/bin/sh
# A CLI only: never installs or starts another Docker daemon in the job.
set -eu
architecture=$(uname -m)
docker_version=27.5.1
compose_version=2.29.7
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT HUP INT TERM
curl --fail --location --retry 3 \
  "https://download.docker.com/linux/static/stable/$architecture/docker-$docker_version.tgz" \
  -o "$temporary/docker.tgz"
tar -xzf "$temporary/docker.tgz" -C /usr/local/bin --strip-components=1 docker/docker
mkdir -p /usr/local/lib/docker/cli-plugins
curl --fail --location --retry 3 \
  "https://github.com/docker/compose/releases/download/v$compose_version/docker-compose-linux-$architecture" \
  -o "$temporary/docker-compose-linux-$architecture"
curl --fail --location --retry 3 \
  "https://github.com/docker/compose/releases/download/v$compose_version/docker-compose-linux-$architecture.sha256" \
  -o "$temporary/compose.sha256"
(cd "$temporary" && sha256sum -c compose.sha256)
install -m 0755 "$temporary/docker-compose-linux-$architecture" /usr/local/lib/docker/cli-plugins/docker-compose
docker version
docker compose version
