import "./style.css";
import "./ui/loading-screen.css";
import { RacingApp } from "./app";
const root = document.getElementById("app");
if (!root) throw new Error("Missing application root");
void new RacingApp(root).start();
