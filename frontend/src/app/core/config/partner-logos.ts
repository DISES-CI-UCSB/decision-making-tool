export interface PartnerLogo {
  id: string;
  name: string;
  src: string;
  headerSrc?: string;
}

const logoPath = '/images/partners/';
const headerLogoPath = `${logoPath}header/`;

export const primaryPartnerLogos: readonly PartnerLogo[] = [
  {
    id: 'ideam',
    name: 'IDEAM',
    src: `${logoPath}01-ideam.png`,
    headerSrc: `${headerLogoPath}01-ideam.png`,
  },
  {
    id: 'wcs',
    name: 'Wildlife Conservation Society',
    src: `${logoPath}02-wcs.png`,
    headerSrc: `${headerLogoPath}02-wcs.png`,
  },
  {
    id: 'wwf',
    name: 'World Wildlife Fund',
    src: `${logoPath}03-wwf.webp`,
    headerSrc: `${headerLogoPath}03-wwf.png`,
  },
  {
    id: 'tnc',
    name: 'The Nature Conservancy',
    src: `${logoPath}04-tnc.png`,
    headerSrc: `${headerLogoPath}04-tnc.png`,
  },
  {
    id: 'fundacion-natura',
    name: 'Fundación Natura',
    src: `${logoPath}05-fundacion-natura.png`,
    headerSrc: `${headerLogoPath}05-fundacion-natura.png`,
  },
  {
    id: 'sinchi',
    name: 'Instituto SINCHI',
    src: `${logoPath}06-sinchi.png`,
    headerSrc: `${headerLogoPath}06-sinchi.png`,
  },
  {
    id: 'pnnc',
    name: 'Parques Nacionales Naturales de Colombia',
    src: `${logoPath}07-pnnc.jpeg`,
    headerSrc: `${headerLogoPath}07-pnnc.png`,
  },
  {
    id: 'invemar',
    name: 'INVEMAR',
    src: `${logoPath}08-invemar.png`,
    headerSrc: `${headerLogoPath}08-invemar.png`,
  },
  {
    id: 'iavh',
    name: 'Instituto Humboldt',
    src: `${logoPath}09-iavh.jpg`,
    headerSrc: `${headerLogoPath}09-iavh.png`,
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
    id: 'procat',
    name: 'ProCAT Colombia',
    src: `${logoPath}12-procat.png`,
    headerSrc: `${headerLogoPath}12-procat.png`,
  },
];

export const secondaryPartnerLogos: readonly PartnerLogo[] = [
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
  { id: 'sib-colombia', name: 'SiB Colombia', src: `${logoPath}28-sib-colombia.png` },
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
