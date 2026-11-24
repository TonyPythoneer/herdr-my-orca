# source me. tenv runs a command in the isolated test env only (env -i: nothing inherited, so no HC_SCOPE/HC_TERMINAL_* of the user)
export T=/private/tmp/claude-501/hp.VJUo
TENV=(env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin HOME=/private/tmp/claude-501/hp.VJUo/h HERDR_APP_HOME=/private/tmp/claude-501/hp.VJUo/app HC_SESSION=p HC_LAUNCHD_DIRECT=1 HERDR_TELEMETRY=0 OMP_CODING_AGENT_DIR=/private/tmp/claude-501/hp.VJUo/agent-omp PI_CODING_AGENT_DIR=/private/tmp/claude-501/hp.VJUo/agent-pi)
tenv() { "${TENV[@]}" "$@"; }
