export const FIRST_NAMES = [
  "Patricia", "Raymond", "Olivia", "Nathan", "Camille", "Helen", "Walter", "Grace", "Henry", "Ruby",
  "Samuel", "Claire", "Patrick", "Naomi", "Calvin", "Irene", "Victor", "Lydia", "Owen", "Sylvia",
  "Trevor", "June", "Colin", "Vera", "Miles", "Hannah", "Grant", "Elaine", "Reid", "Pauline",
  "Curtis", "Marjorie", "Neil", "Beverly", "Todd", "Anita", "Glenn", "Theresa", "Wade", "Connie",
  "Brett", "Diane", "Kyle", "Joyce", "Shane", "Gloria", "Lance", "Phyllis", "Derek", "Norma",
  "Craig", "Peggy", "Alan", "Janice", "Bruce", "Marilyn", "Earl", "Carolyn", "Wayne", "Judith",
  "Roy", "Martha", "Carl", "Jean", "Ralph", "Ann", "Eugene", "Doris", "Louis", "Kathryn",
  "Philip", "Judy", "Howard", "Cheryl", "Stanley", "Andrea", "Leonard", "Jacqueline", "Ernest", "Catherine",
  "Peter", "Christine", "Harold", "Deborah", "Gerald", "Rachel", "Dennis", "Carol", "Roger", "Sharon",
  "Lawrence", "Nancy", "Arthur", "Sandra", "Jack", "Betty", "Kenneth", "Dorothy", "Timothy", "Margaret",
];

export const LAST_NAMES = [
  "Holloway", "Whitaker", "Grant", "Crowe", "Ortega", "Ellison", "Pruitt", "Langford", "McCabe", "Yates",
  "Hensley", "Blevins", "Caldwell", "Hargrove", "Pittman", "Sutherland", "McKinney", "Barnett", "Hodge", "Simmons",
  "Tucker", "Harmon", "Steele", "Frazier", "Nichols", "Barker", "Hampton", "McBride", "Goodwin", "Malone",
  "Fitzpatrick", "Horne", "McClure", "Davenport", "Holcomb", "McNeil", "Gaines", "McKnight", "Rowland", "Parks",
  "McIntyre", "Golden", "McPherson", "Terrell", "Wilkins", "McFarland", "Henson", "McDowell", "Blair", "McGee",
  "Oneal", "McLean", "Hendrix", "McCall", "Potts", "McKee", "Gentry", "McCoy", "Hinton", "McDaniel",
  "Crane", "McGrath", "Hobbs", "McKenna", "Frost", "McLeod", "Hahn", "McMahon", "Gould", "McMillan",
  "French", "McNair", "Foreman", "McNally", "Foley", "McNamara", "Fitch", "McQueen", "Finley", "McRae",
  "Ferguson", "Meadows", "Farley", "Melton", "Fairchild", "Mercer", "Everett", "Merrill", "Erwin", "Middleton",
  "Emerson", "Miles", "Elmore", "Miller", "Elliott", "Mills", "Elder", "Mitchell", "Edwards", "Monroe",
];

export const CITIES = [
  { city: "Knoxville", zip: "37919" },
  { city: "Farragut", zip: "37934" },
  { city: "Powell", zip: "37849" },
  { city: "Halls", zip: "37938" },
  { city: "Corryton", zip: "37721" },
  { city: "Karns", zip: "37931" },
  { city: "Hardin Valley", zip: "37932" },
  { city: "Oak Ridge", zip: "37830" },
  { city: "Maryville", zip: "37801" },
  { city: "Alcoa", zip: "37701" },
];

export const STREETS = [
  "Cedar Bluff Overlook", "Westland Demo Trace", "Northshore Ridge", "Kingston Pike Spur",
  "Lovell Station Walk", "Turkey Creek Bend", "Pellissippi View", "Saddlebrook Hollow",
  "Concord Hills Lane", "Beaver Creek Rise", "Emory Road Spur", "Clinton Highway Nook",
  "Broadway Terrace Way", "Magnolia Park Run", "Island Home Bluff", "Sequoyah Hills Path",
  "Bearden Hill Court", "Fountain City Grove", "Inskip Garden Row", "Burlington Ridge",
];

export const PRICEBOOK = [
  { category: "Diagnostics", items: [
    { name: "HVAC Diagnostic", price: 8900, cost: 1800 },
    { name: "After-Hours Diagnostic", price: 14900, cost: 2800 },
    { name: "Plumbing Diagnostic", price: 9900, cost: 2000 },
    { name: "Water Heater Diagnostic", price: 10900, cost: 2200 },
  ]},
  { category: "HVAC Repairs", items: [
    { name: "Capacitor Replacement", price: 24800, cost: 4200 },
    { name: "Contactor Replacement", price: 26900, cost: 4800 },
    { name: "Blower Motor Replacement", price: 68900, cost: 21000 },
    { name: "Condenser Fan Motor", price: 54900, cost: 17000 },
    { name: "TXV Replacement", price: 42900, cost: 12000 },
    { name: "Refrigerant Recharge", price: 38900, cost: 9000 },
  ]},
  { category: "Electrical Components", items: [
    { name: "Control Board", price: 52900, cost: 16000 },
    { name: "Transformer", price: 18900, cost: 3500 },
    { name: "Disconnect Replacement", price: 21900, cost: 4000 },
  ]},
  { category: "Airflow", items: [
    { name: "Drain Clearing", price: 17900, cost: 2500 },
    { name: "Blower Wheel Cleaning", price: 22900, cost: 3000 },
    { name: "Filter Upgrade", price: 8900, cost: 1800 },
  ]},
  { category: "Indoor Air Quality", items: [
    { name: "UV Light Install", price: 42900, cost: 11000 },
    { name: "Media Filter Cabinet", price: 38900, cost: 9000 },
    { name: "Humidifier Service", price: 18900, cost: 3500 },
  ]},
  { category: "Thermostats", items: [
    { name: "Standard Thermostat", price: 24900, cost: 6000 },
    { name: "Wi-Fi Thermostat", price: 34900, cost: 9000 },
  ]},
  { category: "Maintenance", items: [
    { name: "Precision Tune-Up", price: 14900, cost: 2800 },
    { name: "Member Maintenance Visit", price: 0, cost: 2800 },
    { name: "Coil Cleaning", price: 21900, cost: 3500 },
  ]},
  { category: "Plumbing", items: [
    { name: "Leak Repair", price: 28900, cost: 6000 },
    { name: "Drain Clearing", price: 22900, cost: 3500 },
    { name: "Fixture Repair", price: 18900, cost: 3200 },
    { name: "Pressure Regulator", price: 34900, cost: 8000 },
  ]},
  { category: "Water Heaters", items: [
    { name: "Water Heater Element", price: 26900, cost: 5500 },
    { name: "Anode Rod Replacement", price: 24900, cost: 4000 },
    { name: "40-Gallon Water Heater", price: 189900, cost: 72000 },
    { name: "Tankless Water Heater", price: 329900, cost: 140000 },
  ]},
  { category: "System Replacements", items: [
    { name: "2.5 Ton Heat Pump Good", price: 980000, cost: 420000 },
    { name: "3 Ton Heat Pump Better", price: 1280000, cost: 540000 },
    { name: "3 Ton Heat Pump Best", price: 1540000, cost: 640000 },
    { name: "Gas Furnace Replacement", price: 620000, cost: 260000 },
  ]},
];
