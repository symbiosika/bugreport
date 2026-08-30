const de = {
  reportBug: "Fehler melden",
  consentTitle: "Bildschirmaufnahme für Fehlermeldung",
  consentAccept: "Zustimmen und Aufnahme starten",
  consentCancel: "Abbrechen",
  consentTabHint:
    'Bitte im nächsten Dialog nur „diesen Tab" freigeben, damit keine anderen Fenster aufgezeichnet werden.',
  recording: "Aufnahme läuft",
  screenshot: "Screenshot",
  pause: "Pause",
  resume: "Weiter",
  submit: "Übermitteln",
  cancel: "Abbrechen",
  commentTitle: "Möchtest du noch etwas ergänzen?",
  commentPlaceholder: "Optionaler Kommentar …",
  send: "Absenden",
  uploading: "Wird übermittelt …",
  submittedTitle: "Meldung übermittelt",
  submittedText: "Danke! Deine Fehlermeldung wurde übermittelt.",
  reportIdLabel: "Meldungs-ID",
  close: "Schließen",
  errorTitle: "Fehler",
  errorGeneric: "Die Meldung konnte nicht übermittelt werden.",
  maxDurationReached: "Maximale Aufnahmedauer erreicht — Aufnahme beendet.",
};

const en: typeof de = {
  reportBug: "Report a bug",
  consentTitle: "Screen recording for bug report",
  consentAccept: "Agree and start recording",
  consentCancel: "Cancel",
  consentTabHint:
    'In the next dialog please share only "this tab" so no other windows are recorded.',
  recording: "Recording",
  screenshot: "Screenshot",
  pause: "Pause",
  resume: "Resume",
  submit: "Submit",
  cancel: "Cancel",
  commentTitle: "Anything to add?",
  commentPlaceholder: "Optional comment …",
  send: "Send",
  uploading: "Uploading …",
  submittedTitle: "Report submitted",
  submittedText: "Thanks! Your bug report has been submitted.",
  reportIdLabel: "Report ID",
  close: "Close",
  errorTitle: "Error",
  errorGeneric: "The report could not be submitted.",
  maxDurationReached: "Maximum recording time reached — recording stopped.",
};

export type Messages = typeof de;

export function getMessages(locale?: string): Messages {
  const l = locale ?? (typeof navigator !== "undefined" ? navigator.language : "en");
  return l.toLowerCase().startsWith("de") ? de : en;
}
