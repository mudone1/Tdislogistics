export const AIRPORT_ALIASES: Record<string, string> = {
  enugu: "ENU",
  enugn: "ENU",
  enu: "ENU",

  lagos: "LOS",
  los: "LOS",

  abuja: "ABV",
  abv: "ABV",
  fct: "ABV",

  "port harcourt": "PHC",
  portharcourt: "PHC",
  "port-harcourt": "PHC",
  ph: "PHC",
  phc: "PHC",

  ilorin: "ILR",
  ilr: "ILR",

  kano: "KAN",
  kan: "KAN",

  owerri: "QOW",
  benin: "BNI",
  "benin city": "BNI",
  calabar: "CBQ",
  uyo: "QUO",
  ibom: "QUO",
  akure: "AKR",
  yola: "YOL",
  maiduguri: "MIU",
  sokoto: "SKO",
  kaduna: "KAD",
  jos: "JOS",
  minna: "MXJ",
  warri: "QRW",

  asaba: "ABB",
  bauchi: "BCU",
  gombe: "GMO",
  katsina: "DKA",
  yenagoa: "BIA",
  ekiti: "EKK",
  anambra: "ANA",
  accra: "ACC",
};

export const AIRPORT_NAMES_BY_LENGTH = Object.keys(AIRPORT_ALIASES).sort((a, b) => b.length - a.length);
