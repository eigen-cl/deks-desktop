import { useState } from "react";
import { FolderPlus, X } from "lucide-react";
import { Modal } from "../ui/Modal";
import { SelectField } from "../ui/fields";
import { AgentSetup, type AgentSetupProps } from "./AgentSetup";
import { LOCALES, LOCALE_LABELS, type Locale, type Translate } from "../i18n";

type Section = "general" | "folders" | "agents";

export interface SettingsDialogProps {
  t: Translate;
  locale: Locale;
  defaultRoot: string;
  sourceFolders: string[];
  busy?: boolean;
  agents: Omit<AgentSetupProps, "t" | "projectsRoot" | "busy">;
  onLocaleChange(locale: Locale): void;
  onAddSourceFolder(): void;
  onRemoveSourceFolder(path: string): void;
  onClose(): void;
}

const SECTIONS: Section[] = ["general", "folders", "agents"];

/**
 * Configuración del host en un solo lugar. El idioma vivía en la barra del
 * inicio, donde competía con la búsqueda y con crear: se cambia una vez y
 * después estorba.
 */
export function SettingsDialog({
  t,
  locale,
  defaultRoot,
  sourceFolders,
  busy = false,
  agents,
  onLocaleChange,
  onAddSourceFolder,
  onRemoveSourceFolder,
  onClose,
}: SettingsDialogProps) {
  const [section, setSection] = useState<Section>("general");
  const label: Record<Section, string> = {
    general: t("settings.general"),
    folders: t("settings.folders"),
    agents: t("settings.agents"),
  };

  return (
    <Modal title={t("settings.title")} closeLabel={t("action.close")} size="wide" onClose={onClose}>
      <div className="settings">
        <nav className="settings__nav" aria-label={t("settings.title")}>
          {SECTIONS.map((value) => (
            <button
              key={value}
              type="button"
              aria-current={section === value}
              className={section === value ? "is-active" : ""}
              onClick={() => setSection(value)}
            >
              {label[value]}
            </button>
          ))}
        </nav>

        <div className="settings__content">
          {section === "general" && (
            <section className="panel">
              <SelectField
                label={t("home.language")}
                value={locale}
                options={LOCALES.map((value) => ({ value, label: LOCALE_LABELS[value] }))}
                onValueChange={(value) => onLocaleChange(value as Locale)}
              />
              <p className="panel__hint">{t("settings.languageHint")}</p>
              <p className="panel__hint">{t("home.localContract")}</p>
            </section>
          )}

          {section === "folders" && (
            <section className="panel">
              <p className="panel__hint">{t("settings.foldersHint")}</p>
              <ul className="settings__folders">
                <li>
                  <span>{defaultRoot}</span>
                  <span className="badge badge--quiet">{t("home.defaultRoot")}</span>
                </li>
                {sourceFolders.map((path) => (
                  <li key={path}>
                    <span>{path}</span>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={t("home.removeSourceFolder")}
                      onClick={() => onRemoveSourceFolder(path)}
                    >
                      <X aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" className="button" disabled={busy} onClick={onAddSourceFolder}>
                <FolderPlus aria-hidden="true" /> {t("home.addSourceFolder")}
              </button>
            </section>
          )}

          {section === "agents" && (
            <AgentSetup t={t} projectsRoot={defaultRoot} busy={busy} {...agents} />
          )}
        </div>
      </div>
    </Modal>
  );
}
