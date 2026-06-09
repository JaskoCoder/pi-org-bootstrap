/**
 * Instance Username Extension
 *
 * Assigns a random fun "username" (codename) to each pi session.
 * The username persists across reloads within the same session via appendEntry
 * and is displayed in the TUI footer and session name.
 *
 * Triggers on: session_start event
 * Uses: pi.appendEntry() for persistence, ctx.ui.setStatus() for display,
 *       pi.setSessionName() for session labeling
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// ─── Internet-Style Usernames ────────────────────────────────────────
// Memorable, fun names — the kind you'd see on Discord, gaming, or Reddit.
// Mix of vibes: cute, badass, silly, mysterious, nerdy, food+animal combos.
const USERNAMES = [
	// ── Tech + Animal ────────────────────────────────────────
	"PixelWizard", "NeonDragon", "CyberFox", "QuantumPanda", "TurboSloth",
	"GlitchGoblin", "ElectricCheetah", "SolarSurfer", "VoidWalker", "BinaryBunny",
	"LaserPenguin", "HologramHamster", "PlasmaParrot", "CircuitCat", "DataDolphin",
	"PixelPanda", "RadarRaven", "ProxyPenguin", "CacheCoyote", "KernelKoala",
	"VectorViper", "StackSnail", "DebugDragon", "TokenTiger", "PingPanda",
	"WifiWalrus", "RootRaccoon", "SudoSquid", "ByteBat", "NodeNarwhal",

	// ── Color + Creature ─────────────────────────────────────
	"CrimsonWaffle", "SapphireEcho", "MidnightOwl", "ShadowPenguin", "AmberMoth",
	"CoralCactus", "IndigoImp", "JadeJellyfish", "MagentaMole", "ScarletSpud",
	"TealTornado", "VioletVole", "RubyRacoon", "EmeraldEcho", "OnyxOrca",
	"IvoryIguana", "BronzeBeetle", "SilverSprout", "CopperCrow", "GoldGoose",

	// ── Food + Animal ────────────────────────────────────────
	"CosmicPotato", "LavaPancake", "PhantomBagel", "MysticRamen", "ThunderSnail",
	"RogueCarrot", "NoodleNinja", "PancakePanda", "WaffleWolf", "TacoTurtle",
	"BurritoBat", "MuffinMoth", "PretzelPuma", "SushiSloth", "DonutDragon",
	"BagelBear", "ToffeeTiger", "PepperPenguin", "BiscuitBunny", "PuddingPhoenix",

	// ── Badass / Mysterious ──────────────────────────────────
	"ObsidianFlare", "StormWeaver", "DuskRunner", "RiftWalker", "AshWarden",
	"BlazeFury", "FrostBite", "HollowGhost", "IronReaper", "NightShade",
	"PhantomEdge", "RazorWind", "SteelVortex", "ThornKnight", "VenomSpire",
	"WraithHunter", "ZeroScope", "DarkPulse", "GhostBlade", "NovaBurst",

	// ── Cute / Wholesome ─────────────────────────────────────
	"CozyCloud", "DewdropDeer", "FuzzyPeach", "GentleBreeze", "HoneyBee",
	"LilacDove", "MapleSprout", "PetalPig", "SunnyMoth", "VelvetMoth",
	"BumbleBun", "CottonFox", "DaisyDrake", "FernFrog", "MarigoldMouse",
	"PippinPup", "SproutSnail", "WhiskerWren", "BrambleBadger", "CloverCat",

	// ── Nerdy / Sci-Fi ───────────────────────────────────────
	"QuantumToast", "NeutrinoNinja", "PhotonPirate", "TachyonTurtle", "QuarkQuest",
	"EntropyEngine", "WarpWalrus", "SingularitySlug", "NebulaNoodle", "PulsarPig",
	"NovaNarwhal", "AstroAnchovy", "CometCorgi", "EclipseEagle", "GravityGoat",
	"MagnetarMole", "OrbitOtter", "PlutoPanda", "StellarStoat", "ZenithZebra",

	// ── Silly / Absurd ───────────────────────────────────────
	"JazzHands", "DiscoPotato", "ChaoticSpoon", "NervousPuddle", "SassyBrick",
	"ConfusedCactus", "DramaticWaffle", "ElegantTrash", "FancyMud", "GrumpyCloud",
	"SuspiciousTurnip", "PhilosophicalFungus", "AngryNoodle", "PoliteStorm",
	"BoredAvocado", "DizzyCactus", "FuriousMuffin", "GigglingGhost",
	"PanickedPancake", "ZenZucchini",

	// ── Nature + Element ─────────────────────────────────────
	"ThunderOak", "MossGolem", "RiverSprite", "BarkKnight", "EmberSeed",
	"FrostWillow", "LavaLamprey", "MistWalker", "TideCaller", "WindWhisper",
	"AuroraFox", "BlizzardBadger", "CanyonCrow", "DuneDrifter", "GlacierGoose",
	"LightningLynx", "MonsoonMantis", "QuakeQuail", "TsunamiToad", "VolcanoVole",

	// ── Music + Sound ────────────────────────────────────────
	"BassBasilisk", "TrebleTiger", "EchoEcho", "RhythmRaven", "MelodyMoth",
	"DrumDodo", "SynthSpider", "HarmonyHawk", "TempoTurtle", "ChorusCheetah",
	"VinylViper", "ReverbRabbit", "AcousticApe", "BeatBadger", "FuzzFox",

	// ── Extra — reaching 200 ─────────────────────────────────
	"RogueStar", "CoralReef", "BoltBunny", "FrostyFern", "Embermoth",
	"LunarLynx", "RiftRabbit", "SonicShroom", "PixelPlum", "HazyDaze",
	"NeonNarwhal", "CosmicCrab", "VelvetVoyage", "PrismPanda", "HexHedgehog",
] as const;

// Combine all into flat list
export const ALL_NAMES: readonly string[] = [...USERNAMES];

// Total: 200 names

export function pickRandomName(): string {
	return ALL_NAMES[Math.floor(Math.random() * ALL_NAMES.length)];
}

// ─── Extension Entry Point ──────────────────────────────────────────

const STORAGE_KEY = "instance-username";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		// Check if a username was already stored in this session
		let username: string | undefined;
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type === "custom" && entry.customType === STORAGE_KEY) {
				username = entry.data?.name as string | undefined;
				if (username) break;
			}
		}

		// If no stored name, pick a new one
		if (!username) {
			username = pickRandomName();
			pi.appendEntry(STORAGE_KEY, { name: username });
		}

		// Display in TUI footer via setStatus
		const theme = ctx.ui.theme;
		ctx.ui.setStatus("instance-username", `${theme.fg("accent", "🤖")} ${theme.fg("text", username)}`);

		// Set session name so it shows in session selector
		const existingName = pi.getSessionName();
		if (!existingName) {
			pi.setSessionName(`🤖 ${username}`);
		}

		ctx.ui.notify(`Instance: ${username}`, "info");
	});

	// Register a command to re-roll the username
	pi.registerCommand("reroll-username", {
		description: "Pick a new random username for this session",
		handler: async (_args, ctx) => {
			const username = pickRandomName();
			pi.appendEntry(STORAGE_KEY, { name: username });

			const theme = ctx.ui.theme;
			ctx.ui.setStatus("instance-username", `${theme.fg("accent", "🤖")} ${theme.fg("text", username)}`);
			pi.setSessionName(`🤖 ${username}`);

			ctx.ui.notify(`New username: ${username}`, "info");
		},
	});

	// Register a command to show the current username
	pi.registerCommand("whoami", {
		description: "Show the current instance username",
		handler: async (_args, ctx) => {
			let username: string | undefined;
			for (const entry of ctx.sessionManager.getEntries()) {
				if (entry.type === "custom" && entry.customType === STORAGE_KEY) {
					username = entry.data?.name as string | undefined;
					if (username) break;
				}
			}
			ctx.ui.notify(username ? `🤖 ${username}` : "No username assigned yet", "info");
		},
	});
}
