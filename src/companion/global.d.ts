import type { CompanionAPI } from "../../electron/companionContract";
declare global { interface Window { companion: CompanionAPI } }
