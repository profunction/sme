import { createRoot } from "react-dom/client";
import { LanguageProvider } from "./i18n";
import { WebPreview } from "./WebPreview";
import "./web-preview.css";
createRoot(document.getElementById("root")!).render(<LanguageProvider><WebPreview /></LanguageProvider>);
