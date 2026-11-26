import { createRoot } from "react-dom/client";

import "../app/core/events";
import { HistoryPanel } from "../app/own/HistoryPanel";

createRoot(document.body.appendChild(document.createElement("main"))).render(<HistoryPanel />);
