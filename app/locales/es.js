// Español. Same keys as en.js.
export default {
  // ---- header, status, language
  'lang.label': 'Idioma',
  'meta.sub': 'Encadena los próximos trenes regionales entre dos estaciones alemanas cualesquiera con el Deutschlandticket, con una parada intermedia donde quieras. Horas previstas, leídas sin conexión de los horarios guardados en este dispositivo.',
  'status.loading': 'Cargando los horarios...',
  'status.first': 'Cargando los horarios por primera vez (unos 5 MB)...',
  'status.loadFailed': 'No se pudieron cargar los horarios ({message}). El primer inicio necesita conexión a internet.',
  'status.noCache': 'Este navegador no puede guardar los horarios en el dispositivo (necesita Cache Storage con HTTPS). Prueba con un navegador actual.',
  'status.readFailed': 'No se pudieron leer los horarios guardados: {message}',
  'btn.retry': 'Reintentar',

  // ---- age of the timetable
  'age.expired': 'Los horarios terminaron el {last}. Los trenes posteriores a esa fecha no están incluidos; conéctate a internet para actualizarlos.',
  'age.soon': 'Horarios del {date}, válidos hasta el {last} ({left}). Se actualizan solos cuando tienes conexión.',
  'age.lastDay': 'último día',
  'age.moreDays': { one: 'queda {n} día', other: 'quedan {n} días' },
  'age.ok': 'Horarios del {date}, válidos hasta el {last}.',
  'age.offline': 'Sin conexión: se usan los horarios del dispositivo.',
  'age.updated': 'Actualizado ahora mismo.',
  'age.upToDate': 'Al día.',
  'age.checkFailed': 'No se pudo comprobar si hay horarios más recientes ({code}); los datos del dispositivo no han cambiado.',

  // ---- the trip form
  'aria.trip': 'Viaje',
  'field.station': 'Estación',
  'field.start': 'Origen',
  'field.date': 'Fecha',
  'field.leaveAfter': 'Salir a partir de',
  'field.target': 'Destino',
  'field.via': 'Parada intermedia (opcional)',
  'field.stay': 'Estancia mínima (min)',
  'field.change': 'Transbordo mínimo (min)',
  'btn.plan': 'Planificar cadena',
  'btn.swap': 'Intercambiar origen y destino',
  'btn.clearvia': 'Sin parada intermedia',

  // ---- tabs
  'tab.chain': 'Cadena',
  'tab.reach': 'Mapa',
  'tab.deps': 'Salidas',
  'tab.live': 'Plan B',

  // ---- chain
  'chain.intro': 'Elige una estación de origen y una de destino para encadenar los próximos trenes regionales entre ambas.',
  'chain.pickBoth': 'Elige una estación de origen y una de destino entre las sugerencias.',
  'chain.noTrainToday': 'No hay ningún tren utilizable desde {from} el {day} a partir de {time}. La primera cadena sale el {first}.',
  'chain.timeRange': '{dep} a {arr}',
  'leg.fromTo': '{from} a {to}',
  'chain.onTheWay': 'de viaje',
  'chain.changes': { one: 'transbordo', other: 'transbordos' },
  'chain.changesStop': { one: 'transbordo más la parada', other: 'transbordos más la parada' },
  'chain.stay': 'Parada en {station}: llegada {arr}, salida {dep} ({dur})',
  'chain.wait': '{min} de espera en {station}',
  'chain.waitTight': '{min} de espera en {station} (transbordo justo)',
  'chain.walk': 'Camina de {from} a {to}',
  'leg.towards': 'dirección {term}, {dur}',
  'btn.out': '¿Este tren está cancelado?',
  'chain.nextTrains': 'Próximos trenes en cada parada',
  'chain.arrive': '(llegada {time})',
  'dep.towards': 'dirección {term}',
  'dep.nextStop': 'próxima parada {stop}',

  // ---- reach map
  'reach.within': 'Mostrar estaciones alcanzables en {hours} h o menos desde la salida',
  'reach.sooner': 'antes',
  'reach.later': 'más tarde',
  'reach.note': 'Cada punto es una estación accesible en tren regional. El color indica en cuánto tiempo puedes llegar desde la estación de origen. Haz clic en un punto para planificar una cadena hasta allí.',

  // ---- departures
  'field.after': 'A partir de',
  'deps.pick': 'Elige una estación.',
  'deps.none': 'No hay salidas después de esa hora.',
  'deps.th.departs': 'Salida',
  'deps.th.line': 'Línea',
  'deps.th.towards': 'Dirección',
  'deps.th.next': 'Próxima parada',

  // ---- Plan B
  'live.intro': '¿Tu tren está cancelado? Indica dónde estás y adónde vas. Verás las alternativas para seguir desde aquí, cada una comparada con tu plan, y cuántos trenes por hora hay en cada tramo.',
  'field.iAmAt': 'Estoy en',
  'field.timeNow': 'Hora actual',
  'field.goingTo': 'Voy a',
  'field.plannedArr': 'Llegada prevista (opcional)',
  'btn.locate': 'Usar mi ubicación',
  'live.say': 'Indica dónde estás y adónde vas.',
  'live.depsTitle': 'Trenes desde {station} a partir de {time}',
  'live.noMoreToday': 'Según los horarios, no sale ningún tren de {station} en esta fecha después de {time}. Estos son del día siguiente (+1).',
  'live.tick': 'Marca los trenes cancelados.',
  'live.unlisted': { one: '{n} tren más marcado antes como cancelado, no está en esta lista.', other: '{n} trenes más marcados antes como cancelados, no están en esta lista.' },
  'live.leadPlan': 'Llegada según tu plan: {plan}. Mejor alternativa para seguir: llegada {best}{later}.',
  'live.later': ', {dur} más tarde',
  'live.leadBest': 'No indicaste una llegada prevista, así que la mejor alternativa (llegada {best}) sirve de referencia.',
  'graph.label': 'Alternativas de {from} a {to}',

  // ---- Plan B: how a way compares
  'chip.best': 'mejor alternativa',
  'chip.best.good': 'cerca de la mejor, +{dur}',
  'chip.best.mid': 'más tarde, +{dur}',
  'chip.best.bad': 'mucho más tarde, +{dur}',
  'chip.plan.early': 'según el plan, {dur} antes',
  'chip.plan.exact': 'según el plan',
  'chip.plan.good': 'según el plan, +{dur}',
  'chip.plan.mid': 'con retraso, +{dur}',
  'chip.plan.bad': 'mucho más tarde, +{dur}',
  'tag.earliest': 'Llegada más temprana',
  'tag.fewest': 'Menos transbordos',
  'tag.robust': 'Más trenes por hora',
  'opt.arrive': 'llegada',
  'opt.leave': 'salida {time}',
  'opt.changes': { one: '{n} transbordo', other: '{n} transbordos' },
  'opt.tightest': 'transbordo más justo {min}',
  'opt.thinnest': { one: 'tramo menos frecuente: {n} tren por hora', other: 'tramo menos frecuente: {n} trenes por hora' },

  // ---- Plan B: legend. green, amber and red are the colours of the chips and lines
  'legend.green': 'verde',
  'legend.amber': 'ámbar',
  'legend.red': 'rojo',
  'legend.basePlan': 'tu plan',
  'legend.baseBest': 'la mejor alternativa',
  'legend.good': 'hasta {n} min después de {base}',
  'legend.mid': 'hasta {n} min',
  'legend.bad': 'más allá.',
  'legend.thick': 'Grosor de la línea: trenes por hora en ese tramo, de uno (fina) a cuatro o más (gruesa).',
  'legend.dotted': 'La línea de puntos: el plan que tenías.',
  'legend.context': 'Gris: las demás estaciones a las que puedes llegar desde aquí.',

  // ---- Plan B: where you are
  'loc.looking': 'Buscando tu ubicación...',
  'loc.unsupported': 'Este navegador no puede saber dónde estás. Elige la estación por su nombre.',
  'loc.denied': 'La ubicación no está permitida para esta página. Permítela para este sitio en los ajustes del navegador, o elige la estación por su nombre.',
  'loc.unavailable': 'El dispositivo no pudo determinar dónde estás. Elige la estación por su nombre.',
  'loc.timeout': 'Encontrar tu ubicación tardó demasiado. Inténtalo de nuevo o elige la estación por su nombre.',
  'loc.none': 'No hay ninguna estación con trenes regionales a menos de 40 km. Elige la estación por su nombre.',
  'loc.near': 'Estás cerca de {station} ({dist}). Fecha y hora ajustadas a ahora.',
  'loc.rough': 'La ubicación solo es precisa a unos {km} km, así que revisa la estación.',
  'loc.private': 'Tu ubicación se queda en este dispositivo.',
  'loc.notHere': '¿No estás aquí?',

  // ---- search errors
  'err.sameStation': 'El origen y el destino son la misma estación.',
  'err.viaUnreachable': 'No se puede llegar a la parada intermedia después de la hora de salida.',
  'err.noOnward': 'No hay conexión para seguir después de la estancia; prueba con una estancia más corta o una salida más temprana.',
  'err.noConnection': 'No hay ninguna conexión ese día después de la hora de salida.',
  'err.alreadyThere': 'Ya estás en el destino.',
  'err.noWay': 'No hay forma de llegar al destino desde aquí después de esa hora.',

  // ---- footer
  'foot': 'Horarios: {publisher}, {license}. {stations} estaciones, {connections} conexiones, del {first} al {last}. Solo horas previstas, sin retrasos ni obras. Comprueba el viaje en DB Navigator antes de salir.',

  // ---- units. {n} is a number
  'unit.h': 'h',
  'unit.min': 'min',
  'unit.m': '{n} m',
  'unit.km': '{n} km',
  'unit.perHour': '{n}/h',

  // ---- the page for an address that does not exist
  'nf.title': 'No encontrado',
  'nf.body': 'No hay ninguna página en esta dirección. {app} planifica cadenas de trenes regionales con el Deutschlandticket, sin conexión.',
};
