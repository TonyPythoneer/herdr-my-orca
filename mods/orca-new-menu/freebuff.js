const FREEBUFF_RUN = [
	"zsh",
	"-lic",
	"exec freebuff"
];
function freebuffProbeArgs() {
	return ["-lic", "command -v -- freebuff >/dev/null 2>&1"];
}
async function detectFreebuff(exec, machine = null) {
	try {
		return (await exec("zsh", freebuffProbeArgs(), {
			timeout: 1e4,
			...machine ? { on: machine } : {}
		})).code === 0;
	} catch {
		return false;
	}
}

export { FREEBUFF_RUN, detectFreebuff, freebuffProbeArgs };
