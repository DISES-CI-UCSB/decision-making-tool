export interface PartnerLogo {
  id: string;
  name: string;
  src: string;
  headerSrc?: string;
}

export interface AboutPartnerSection {
  id: string;
  titleKey: string;
  descriptionKey?: string;
  emptyMessageKey?: string;
  logos: readonly PartnerLogo[];
}

const logoPath = '/images/partners/';
const headerLogoPath = `${logoPath}header/`;
const institutionLogoPath = '/images/institutions/';

export const nationalInstitutionLogos: readonly PartnerLogo[] = [
  {
    id: 'minambiente-temporal',
    name: 'Ministerio de Ambiente y Desarrollo Sostenible',
    src: `${logoPath}46-minambiente-temporal.webp`,
  },
  {
    id: 'pnnc',
    name: 'Parques Nacionales Naturales de Colombia',
    src: `${logoPath}07-pnnc.jpeg`,
    headerSrc: `${headerLogoPath}07-pnnc.png`,
  },
  {
    id: 'iavh',
    name: 'Instituto de Investigación de Recursos Biológicos Alexander von Humboldt',
    src: `${logoPath}09-iavh.jpg`,
    headerSrc: `${headerLogoPath}09-iavh.png`,
  },
  {
    id: 'invemar',
    name: 'INVEMAR',
    src: `${logoPath}08-invemar.png`,
    headerSrc: `${headerLogoPath}08-invemar.png`,
  },
  {
    id: 'ideam',
    name: 'IDEAM',
    src: `${logoPath}01-ideam.png`,
    headerSrc: `${headerLogoPath}01-ideam.png`,
  },
  {
    id: 'sinchi',
    name: 'Instituto Amazónico de Investigaciones Científicas SINCHI',
    src: `${logoPath}06-sinchi.png`,
    headerSrc: `${headerLogoPath}06-sinchi.png`,
  },
  {
    id: 'iiap',
    name: 'Instituto de Investigaciones Ambientales del Pacífico',
    src: `${logoPath}47-iiap.png`,
  },
];

export const funderLogos: readonly PartnerLogo[] = [
  {
    id: 'rdm',
    name: 'Rapid Deployment Mechanism (RDM) Awardee 2025',
    src: `${logoPath}49-rdm-awardee-2025.jpeg`,
  },
  {
    id: 'pnud',
    name: 'Programa de las Naciones Unidas para el Desarrollo',
    src: `${logoPath}48-pnud.svg`,
  },
  {
    id: 'ecoplan',
    name: 'ECO-PLAN',
    src: `${institutionLogoPath}ecoplan.png`,
  },
  {
    id: 'nsf',
    name: 'National Science Foundation',
    src: `${institutionLogoPath}nsf.svg`,
  },
  {
    id: 'ucsb',
    name: 'University of California, Santa Barbara',
    src: `${institutionLogoPath}ucsb.jpg`,
  },
];

export const allyLogos: readonly PartnerLogo[] = [
  {
    id: 'wwf',
    name: 'World Wildlife Fund',
    src: `${logoPath}03-wwf.webp`,
    headerSrc: `${headerLogoPath}03-wwf.png`,
  },
  {
    id: 'procat',
    name: 'ProCAT Colombia',
    src: `${logoPath}12-procat.png`,
    headerSrc: `${headerLogoPath}12-procat.png`,
  },
  {
    id: 'tnc',
    name: 'The Nature Conservancy',
    src: `${logoPath}04-tnc.png`,
    headerSrc: `${headerLogoPath}04-tnc.png`,
  },
  {
    id: 'wcs',
    name: 'Wildlife Conservation Society',
    src: `${logoPath}02-wcs.png`,
    headerSrc: `${headerLogoPath}02-wcs.png`,
  },
  {
    id: 'tropembos',
    name: 'Tropenbos Colombia',
    src: `${logoPath}10-tropembos.png`,
    headerSrc: `${headerLogoPath}10-tropembos.png`,
  },
  {
    id: 'fundacion-malpelo',
    name: 'Fundación Malpelo',
    src: `${logoPath}11-fundacion-malpelo.jpg`,
    headerSrc: `${headerLogoPath}11-fundacion-malpelo.png`,
  },
  {
    id: 'fundacion-natura',
    name: 'Fundación Natura Colombia',
    src: `${logoPath}05-fundacion-natura.png`,
    headerSrc: `${headerLogoPath}05-fundacion-natura.png`,
  },
  {
    id: 'sib-colombia',
    name: 'SiB Colombia',
    src: `${logoPath}28-sib-colombia.png`,
  },
];

export const sirapLogos: readonly PartnerLogo[] = [];

export const regionalCorporationLogos: readonly PartnerLogo[] = [
  { id: 'cvc', name: 'CVC', src: `${logoPath}13-cvc.png` },
  { id: 'cas', name: 'CAS', src: `${logoPath}14-cas.jpeg` },
  { id: 'corporinoquia', name: 'Corporinoquia', src: `${logoPath}15-corporinoquia.png` },
  { id: 'cardique', name: 'Cardique', src: `${logoPath}16-cardique.png` },
  { id: 'cda', name: 'CDA', src: `${logoPath}17-cda.jpg` },
  { id: 'cdmb', name: 'CDMB', src: `${logoPath}18-cdmb.jpeg` },
  { id: 'corpomojana', name: 'Corpomojána', src: `${logoPath}19-corpomojana.jpeg` },
  { id: 'corponor', name: 'Corponor', src: `${logoPath}20-corponor.png` },
  { id: 'corpoguavio', name: 'Corpoguavio', src: `${logoPath}21-corpoguavio.png` },
  { id: 'carder', name: 'CARDER', src: `${logoPath}22-carder.png` },
  { id: 'corpocesar', name: 'Corpocesar', src: `${logoPath}23-corpocesar.jpg` },
  { id: 'corponarino', name: 'Corponariño', src: `${logoPath}24-corponarino.jpeg` },
  { id: 'coralina', name: 'Coralina', src: `${logoPath}25-coralina.png` },
  { id: 'cam', name: 'CAM', src: `${logoPath}26-cam.webp` },
  { id: 'crq', name: 'CRQ', src: `${logoPath}27-crq.png` },
  { id: 'corpoguajira', name: 'Corpoguajira', src: `${logoPath}29-corpoguajira.jpg` },
  { id: 'cra', name: 'CRA', src: `${logoPath}30-cra.jpeg` },
  { id: 'codechoco', name: 'Codechocó', src: `${logoPath}31-codechoco.png` },
  { id: 'cornare', name: 'Cornare', src: `${logoPath}32-cornare.png` },
  { id: 'cvs', name: 'CVS', src: `${logoPath}33-cvs.png` },
  { id: 'corpouraba', name: 'Corpourabá', src: `${logoPath}34-corpouraba.webp` },
  { id: 'corpocaldas', name: 'Corpocaldas', src: `${logoPath}35-corpocaldas.png` },
  { id: 'corpochivor', name: 'Corpochivor', src: `${logoPath}36-corpchivor.png` },
  { id: 'car', name: 'CAR', src: `${logoPath}37-car.png` },
  { id: 'carsucre', name: 'Carsucre', src: `${logoPath}38-carsucre.webp` },
  { id: 'crc', name: 'CRC', src: `${logoPath}39-crc.png` },
  { id: 'cortolima', name: 'Cortolima', src: `${logoPath}40-cortolima.jpeg` },
  { id: 'cormacarena', name: 'Cormacarena', src: `${logoPath}41-cormacarena.png` },
  { id: 'asocars', name: 'Asocars', src: `${logoPath}42-asocars.jpg` },
  { id: 'corpoboyaca', name: 'Corpoboyacá', src: `${logoPath}43-corpoboyaca.jpg` },
  { id: 'corantioquia', name: 'Corantioquia', src: `${logoPath}44-corantioquia.png` },
  { id: 'corpoamazonia', name: 'Corpoamazonia', src: `${logoPath}45-corpoamazonia.png` },
];

export const aboutPartnerSections: readonly AboutPartnerSection[] = [
  {
    id: 'national-institutions',
    titleKey: 'about.nationalInstitutionsTitle',
    descriptionKey: 'about.nationalInstitutionsDescription',
    logos: nationalInstitutionLogos,
  },
  {
    id: 'funders',
    titleKey: 'about.fundersTitle',
    descriptionKey: 'about.fundersDescription',
    logos: funderLogos,
  },
  {
    id: 'allies',
    titleKey: 'about.alliesTitle',
    descriptionKey: 'about.alliesDescription',
    logos: allyLogos,
  },
  {
    id: 'sirap',
    titleKey: 'about.sirapTitle',
    descriptionKey: 'about.sirapDescription',
    emptyMessageKey: 'about.sirapEmptyMessage',
    logos: sirapLogos,
  },
  {
    id: 'regional-corporations',
    titleKey: 'about.regionalCorporationsTitle',
    descriptionKey: 'about.regionalCorporationsDescription',
    logos: regionalCorporationLogos,
  },
];

const hacHeaderLogo: PartnerLogo = {
  id: 'hac',
  name: 'HAC',
  src: `${logoPath}49-rdm-awardee-2025.jpeg`,
};

const partnerLogoCatalog = new Map<string, PartnerLogo>(
  [...nationalInstitutionLogos, ...allyLogos, hacHeaderLogo].map((logo) => [logo.id, logo]),
);

/** Header carousel logos — NM 9/4 order. */
const primaryPartnerLogoIds = [
  'minambiente-temporal',
  'pnnc',
  'iavh',
  'invemar',
  'sinchi',
  'ideam',
  'iiap',
  'procat',
  'wwf',
  'tnc',
  'wcs',
  'hac',
] as const;

export const primaryPartnerLogos: readonly PartnerLogo[] = primaryPartnerLogoIds.map(
  (id) => partnerLogoCatalog.get(id)!,
);
