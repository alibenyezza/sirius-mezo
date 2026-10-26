#!/usr/bin/env bash
set -euo pipefail

cd "${1:?Dossier VPS requis}"
compose=(docker compose -p "${2:?Projet Compose requis}" --env-file .env.vps)

echo '[reaper] État du service'
"${compose[@]}" ps --all reaper
container=$("${compose[@]}" ps --all --quiet reaper)
if [[ -z "$container" ]]; then
  echo '::error::Aucun conteneur reaper dans le projet Compose ciblé.'
  exit 1
fi

state=$(docker inspect --type container --format '{{.State.Status}} {{.State.ExitCode}} {{.State.OOMKilled}} {{.RestartCount}}' "$container")
read -r status exit_code oom restarts <<< "$state"
printf '[reaper] statut=%s code=%s mémoire_dépassée=%s redémarrages=%s\n' "$status" "$exit_code" "$oom" "$restarts"
if [[ "$status" != running ]]; then
  "${compose[@]}" logs --no-color --tail 60 reaper || true
  echo '::error::Le reaper ne tourne pas. Voir son état et ses logs ci-dessus.'
  exit 1
fi

echo '[reaper] Processus en cours d’exécution'

# Un conteneur « running » peut être bloqué ou relancer sans fin sa configuration : on exige
# une passe réussie (« passe ok ») dans les deux dernières minutes. Ni « démarré » ni
# « passe échouée » ne suffisent : un reaper qui tourne sans réconcilier n'est pas sain.
for attempt in $(seq 1 12); do
  if "${compose[@]}" logs --no-color --since 2m reaper 2>/dev/null | grep -qE '\[reaper\] passe ok '; then
    echo '[reaper] Ligne de vie récente trouvée'
    exit 0
  fi
  sleep 10
done
"${compose[@]}" logs --no-color --tail 60 reaper || true
echo '::error::Le reaper tourne mais ne journalise aucune passe réussie depuis deux minutes.'
exit 1
