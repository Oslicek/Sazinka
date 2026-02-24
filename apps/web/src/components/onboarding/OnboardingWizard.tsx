import { createContext, lazy, Suspense, useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StepIndicator } from './StepIndicator';
import type { WizardContext, WizardState } from './types';
import styles from './OnboardingWizard.module.css';

// --------------------------------------------------------------------------
// Lazy-loaded step components (all in the same chunk since the wizard itself
// is already lazily imported from the router).
// --------------------------------------------------------------------------
const Landing       = lazy(() => import('./Landing').then(m => ({ default: m.Landing })));
const Step1Account  = lazy(() => import('./Step1Account').then(m => ({ default: m.Step1Account })));
const VerifyEmail   = lazy(() => import('./VerifyEmail').then(m => ({ default: m.VerifyEmail })));
const Step2Profile  = lazy(() => import('./Step2Profile').then(m => ({ default: m.Step2Profile })));
const Step3Devices  = lazy(() => import('./Step3Devices').then(m => ({ default: m.Step3Devices })));
const Step4Depot    = lazy(() => import('./Step4Depot').then(m => ({ default: m.Step4Depot })));
const Step5Done     = lazy(() => import('./Step5Done').then(m => ({ default: m.Step5Done })));

// --------------------------------------------------------------------------
// Context
// --------------------------------------------------------------------------
const Ctx = createContext<WizardContext | null>(null);

export function useWizard(): WizardContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useWizard must be used inside OnboardingWizard');
  return ctx;
}

// --------------------------------------------------------------------------
// History stack for goBack
// --------------------------------------------------------------------------
type Step = WizardState['step'];
const HISTORY_MAP: Partial<Record<string, Step>> = {
  '1': 0,
  '2': 1,
  '3': 2,
  '4': 3,
  '5': 4,
  'verify': 1,
};

function toIndicatorStep(step: Step): number {
  if (step === 'verify') return 1;
  return typeof step === 'number' ? step : 0;
}

// --------------------------------------------------------------------------
// Default locale: Czech (primary market), unless browser is Slovak
// --------------------------------------------------------------------------
function detectLocale(): string {
  const base = navigator.language.split('-')[0].toLowerCase();
  if (base === 'sk') return 'sk';
  return 'cs';
}

export function OnboardingWizard() {
  const { i18n } = useTranslation('onboarding');

  const [step, setStepRaw] = useState<Step>(0);
  const [country, setCountry] = useState('CZ');
  const [locale, setLocaleRaw] = useState(detectLocale);
  const [email, setEmail] = useState('');
  const [deviceTypeCount, setDeviceTypeCount] = useState(0);
  const [depotName, setDepotName] = useState('');

  // On mount: switch i18n to the wizard's default locale (cs)
  useEffect(() => {
    if (i18n.language !== locale) {
      i18n.changeLanguage(locale);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setStep = (s: Step) => setStepRaw(s);

  const setLocale = (l: string) => {
    setLocaleRaw(l);
    i18n.changeLanguage(l);
  };

  const goBack = () => {
    const prev = HISTORY_MAP[String(step)];
    if (prev !== undefined) setStepRaw(prev);
  };

  const handleStepClick = (clickedStep: number) => {
    setStepRaw(clickedStep as Step);
  };

  const ctx: WizardContext = {
    step, setStep,
    country, setCountry,
    locale, setLocale,
    email, setEmail,
    deviceTypeCount, setDeviceTypeCount,
    depotName, setDepotName,
    goBack,
  };

  const showIndicator = step !== 0 && step !== 'verify';
  const indicatorStep = toIndicatorStep(step);

  return (
    <Ctx.Provider value={ctx}>
      <div className={styles.root}>
        {showIndicator && (
          <div className={styles.indicatorBar}>
            <StepIndicator
              currentStep={indicatorStep}
              onStepClick={handleStepClick}
            />
          </div>
        )}

        <main className={styles.content}>
          <Suspense fallback={<div className={styles.loader}>…</div>}>
            {step === 0       && <Landing />}
            {step === 1       && <Step1Account />}
            {step === 'verify' && <VerifyEmail />}
            {step === 2       && <Step2Profile />}
            {step === 3       && <Step3Devices />}
            {step === 4       && <Step4Depot />}
            {step === 5       && <Step5Done />}
          </Suspense>
        </main>
      </div>
    </Ctx.Provider>
  );
}
