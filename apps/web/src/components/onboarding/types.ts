
/** Shared wizard state — passed down via React context. */
export interface WizardState {
  /** Current step: 0 = Landing, 1–5 = wizard steps, 'verify' = awaiting email verification */
  step: 0 | 1 | 2 | 3 | 4 | 5 | 'verify';
  /** ISO 3166-1 alpha-2 country code selected on Landing. */
  country: string;
  /** BCP-47 locale chosen on Landing / Step1. */
  locale: string;
  /** Email entered in Step1 (used on the VerifyEmail interstitial). */
  email: string;
  /** Number of device types the user selected (for Step5 summary). */
  deviceTypeCount: number;
  /** Depot name chosen in Step4 (for Step5 summary). */
  depotName: string;
}

export interface WizardActions {
  setStep: (step: WizardState['step']) => void;
  setCountry: (country: string) => void;
  setLocale: (locale: string) => void;
  setEmail: (email: string) => void;
  setDeviceTypeCount: (n: number) => void;
  setDepotName: (name: string) => void;
  goBack: () => void;
}

export type WizardContext = WizardState & WizardActions;
