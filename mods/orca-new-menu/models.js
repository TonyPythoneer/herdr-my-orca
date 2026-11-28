import { SPECS } from "./agent-flyout.js";
import { exec, home } from "herdr";

                                   
const INSTALL_DIRS = [
	".bun/bin",
	".local/bin",
	".volta/bin",
	".asdf/shims",
	".local/share/mise/shims",
	".local/share/pnpm",
	".yarn/bin",
	"Library/pnpm"
];
async function agentExec(command, args) {
	let first;
	for (const program of [command, ...INSTALL_DIRS.map((dir) => `${home()}/${dir}/${command}`)]) try {
		return await exec(program, args, { timeout: 6e4 });
	} catch (error) {
		first ??= error;
	}
	throw first;
}
async function ompModels() {
	const { stdout } = await agentExec("omp", ["models", "--json"]);
	const start = stdout.indexOf("{");
	const end = stdout.lastIndexOf("}");
	if (start === -1 || end <= start) return [];
	const rows = JSON.parse(stdout.slice(start, end + 1)).models;
	if (!Array.isArray(rows)) return [];
	return rows.flatMap((m) => {
		const id = m?.selector || (m?.provider && m?.id ? `${m.provider}/${m.id}` : "");
		return !id || id === "default" ? [] : [{
			id,
			label: m.name || m.id || id
		}];
	});
}
async function agyModels() {
	const { stdout } = await agentExec("agy", ["models"]);
	return stdout.split("\n").flatMap((line) => {
		const [id, label] = line.split("	");
		return id && label?.trim() ? [{
			id: id.trim(),
			label: label.trim()
		}] : [];
	});
}
const MODELS = {
	...Object.fromEntries(Object.keys(SPECS).map((key) => [key, { flyout: true }])),
	gemini: {
		flag: "-m",
		models: [
			{
				id: "gemini-3-pro-preview",
				label: "Gemini 3 Pro Preview"
			},
			{
				id: "gemini-3-flash-preview",
				label: "Gemini 3 Flash Preview"
			},
			{
				id: "gemini-2.5-pro",
				label: "Gemini 2.5 Pro"
			},
			{
				id: "gemini-2.5-flash",
				label: "Gemini 2.5 Flash"
			}
		]
	},
	grok: {
		flag: "-m",
		models: [
			{
				id: "grok-4.7",
				label: "Grok 4.7"
			},
			{
				id: "grok-4.6",
				label: "Grok 4.6"
			},
			{
				id: "grok-4.5",
				label: "Grok 4.5"
			}
		]
	},
	antigravity: {
		flag: "--model",
		probe: agyModels
	},
	omp: {
		flag: "--model",
		probe: ompModels
	}
};

export { MODELS };
