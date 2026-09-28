import { installFlintUiClickGuard } from "../../src/extensionClickIsolation.js";
import { installMyGreenhouseUiReparentObserver } from "../../src/myGreenhouseUiMount.js";
import { startAutofillController } from "./controller.js";

installFlintUiClickGuard();
installMyGreenhouseUiReparentObserver();
startAutofillController();

export {};
