# MVP de transporte de pasajeros y encomiendas en Santa Cruz de la Sierra

El MVP permitirá solicitar viajes de pasajeros y enviar encomiendas puerta a puerta en Santa Cruz de la Sierra, Bolivia. Tendrá una app Flutter de cliente, otra de conductor, un panel Angular y un backend NestJS con PostgreSQL/PostGIS y Redis. Los cobros serán en efectivo, con importes en bolivianos y conciliación desde el panel.

La ciudad, la cobertura de una sola ciudad, la moneda, el efectivo y las tecnologías fueron confirmados por el usuario. Las reglas operativas indicadas como propuestas son la base para desarrollar y deberán ratificarse antes del piloto. El polígono concreto de cobertura y los valores comerciales se configurarán antes de aceptar servicios reales.

## Entregables del loop 0

- [Alcance, roles y decisiones](README.md).
- [Flujos, estados y reglas](flujos-y-estados.md).
- [Backlog con criterios de aceptación y dependencias](backlog-mvp.md).

## Objetivo del MVP

Validar que un cliente pueda contratar un viaje o envío, recibir un conductor habilitado, seguir su avance y obtener un cierre trazable; que el conductor pueda atenderlo y registrar el efectivo; y que la operación pueda gestionar excepciones y conciliar cobros.

La asignación automática será parte del MVP. La asignación manual permitirá probar el primer recorrido completo y resolver casos operativos, respetando las mismas restricciones.

## Alcance por aplicación

| Superficie | Incluido en el MVP |
| --- | --- |
| App de cliente | Cuenta, contacto, origen y destino, selección de pasajeros o encomiendas, cotización en Bs, solicitud inmediata, conductor asignado, seguimiento, cancelación permitida, códigos de verificación, historial, comprobante del servicio y contacto de soporte. |
| App de conductor | Cuenta, alta y documentos, vehículo, aprobación, disponibilidad por modalidad, ofertas con vencimiento, aceptación, navegación mediante app externa, llegada, inicio del viaje, recogida, entrega, devolución, incidencias, declaración del efectivo y resumen de movimientos. |
| Panel Angular | Usuarios y permisos, conductores y vehículos, revisión de documentos, cobertura, tarifas, mapa operativo, servicios e historial, asignación manual, incidencias, devoluciones, cobros, diferencias, comisiones y conciliación. |
| Backend NestJS | Autorización, reglas y estados, cotizaciones, asignación exclusiva, geografía, ubicación, eventos, notificaciones, movimientos monetarios, auditoría y recuperación. |

El comprobante del MVP resume el servicio y su cobro. La facturación fiscal es una definición adicional que la operación debe resolver antes de ofrecerla; no se presentará el comprobante operativo como factura fiscal.

## Reglas base propuestas

1. Servicios inmediatos, con un origen y un destino dentro del polígono habilitado.
2. Una categoría inicial de vehículo liviano, configurable; el conductor puede habilitar pasajeros, encomiendas o ambas modalidades según su aprobación y capacidad.
3. Un servicio activo por conductor entre ambas modalidades. Una encomienda pendiente de devolución o resolución de custodia conserva esa reserva.
4. Un servicio activo por cuenta de cliente en el MVP. Los reintentos de la misma solicitud devuelven el mismo servicio.
5. Un conductor y un vehículo por servicio. Pasajeros y encomiendas se atienden por separado.
6. Precio fijo para el recorrido y las condiciones aceptadas. La cotización vence para crear una solicitud; confirmar una solicitud vigente congela importe y versión durante su plazo de búsqueda y, si se asigna, durante el servicio.
7. Efectivo como único medio inicial. El pasajero paga al terminar; para encomiendas, el solicitante es responsable y el remitente paga en origen al recoger. El destinatario no paga por recibir.
8. Un intento de entrega de encomienda, con llegada a destino y espera verificables para declarar ausencia. Si falla, el operador gestiona devolución al origen o una resolución documentada. El costo y las condiciones de retorno se informan y aceptan al solicitar.
9. Los contactos de remitente y destinatario pueden participar sin crear cuenta. El solicitante recibe y comunica los códigos necesarios; el conductor nunca puede consultarlos.
10. El backend confirma todas las transiciones críticas. Antes de entregar físicamente un paquete, la recogida debe quedar autorizada por el servidor, bloqueando cancelación y reasignación ordinarias. Después se confirma la recepción material; una pérdida de señal conserva reserva y exige reconciliar la custodia real.
11. La app puede mostrar una acción pendiente de sincronización, pero solo muestra confirmación definitiva después de la respuesta del servidor. Un efectivo recibido antes de recoger debe reembolsarse y documentarse antes de reasignar; si no se logra, se cancela con obligación de reembolso pendiente y sin recobro automático del mismo servicio.

## Funciones posteriores al MVP

| Función | Motivo para postergarla |
| --- | --- |
| Pagos digitales y cobro del valor del contenido | El alcance confirmado es efectivo por el transporte, con registro y conciliación. |
| Envíos interurbanos, sucursales y transferencias de paquetes | Requieren operación por tramos y cambios de custodia adicionales. |
| Viajes compartidos y pasajeros junto con paquetes | Requieren reglas de capacidad y asignación simultánea. |
| Reservas, varias paradas y entregas agrupadas | Agregan planificación y optimización de recorridos. |
| Tarifas dinámicas, promociones y referidos | Se prioriza una cotización estable y verificable. |
| Calificaciones, favoritos y seguimiento compartido por enlace | Se incorporarán después de validar los flujos principales y el control de acceso. |
| Navegación giro a giro dentro de la app | El MVP abrirá una app de navegación externa y conservará el seguimiento del servicio. |
| Liquidaciones bancarias automáticas | El MVP registra movimientos y conciliación de efectivo con responsables. |

## Roles y permisos

Una persona del equipo puede tener varios roles explícitos. Los permisos se verifican en la API y en los eventos en tiempo real, además de las restricciones de interfaz.

| Rol | Acciones autorizadas | Límites |
| --- | --- | --- |
| Cliente | Cotizar, solicitar y consultar sus servicios; cancelar cuando esté permitido; comunicar códigos; ver su comprobante; reportar incidencias y diferencias de efectivo. | No modifica importes, conductor, evidencias ni estados operativos. No accede a servicios ajenos. |
| Conductor | Presentar datos; conectar o desconectar disponibilidad; elegir modalidades habilitadas; atender ofertas propias; ejecutar hitos del servicio asignado; declarar cobro e incidencias. | Necesita aprobación y vehículo vigente. No cambia tarifas ni confirma códigos sin validación del servidor. Solo accede al contacto y ubicación necesarios para su servicio. |
| Operador | Supervisar servicios, asignar o reasignar antes de iniciar el transporte, contactar participantes, tramitar incidencias, autorizar retorno y revisar solicitudes de suspensión con servicio activo. | No borra historial, cambia tarifas, asigna roles ni ajusta dinero sin un permiso adicional. No transfiere automáticamente una encomienda ya recogida. |
| Finanzas | Ver cobros y movimientos, registrar remesas de efectivo y reembolsos efectuados, conciliar diferencias y efectuar ajustes autorizados con motivo. | No marca viajes o paquetes como completados ni modifica documentos o roles. Un reembolso registrado requiere evidencia y responsable. |
| Administrador | Administrar roles y parámetros, aprobar conductores y vehículos, versionar cobertura y tarifas, suspender nuevas operaciones y autorizar cierres excepcionales. | Sus acciones sensibles también quedan auditadas. Una suspensión exige resolver el servicio activo y la custodia; no elimina registros. |
| Remitente o destinatario sin cuenta | Recibir o comunicar el código y participar en recogida, entrega o devolución. | No obtiene acceso al panel ni al historial de la cuenta solicitante. Un código prueba su conocimiento, no identidad personal. |

Se propone acceso móvil por teléfono y código de verificación, con proveedor pendiente de seleccionar. El panel usará cuentas individuales y segundo factor para roles privilegiados. El mecanismo de recuperación se define junto con el proveedor; los códigos de acceso y los de servicio serán independientes.

## Parámetros y decisiones

| ID | Tema | Estado y base de trabajo | Momento de resolución |
| --- | --- | --- | --- |
| DEC-01 | Mercado | Confirmado: Bolivia, Santa Cruz de la Sierra; una ciudad y servicios puerta a puerta. | Resuelto. |
| DEC-02 | Moneda y hora | Confirmado: bolivianos. Propuesta de representación: código BOB, visualización Bs, importes en centavos enteros, hora de interfaz America/La_Paz y almacenamiento UTC. | Representación técnica en loop 1. |
| DEC-03 | Pagos | Confirmado: efectivo con registro y conciliación. Propuestos los responsables y momentos de cobro descritos arriba. | Ratificar cobro al final del viaje antes de operarlo, y cobro en recogida antes del loop 8; completar conciliación en loop 9. |
| DEC-04 | Cobertura exacta | Pendiente el polígono, zonas restringidas y horario real de operación. Nombrar la ciudad no habilita automáticamente todo su municipio. | Cobertura de prueba en loop 3; configuración operativa antes del loop 5 y del piloto. |
| DEC-05 | Vehículos y documentos | Propuesta: una categoría inicial. Pendientes capacidad de pasajeros, tipos de documentos, vigencias y criterios de revisión operativa. | Antes de cerrar el loop 2 para operación. |
| DEC-06 | Tarifas | Pendientes importe mínimo, base, distancia, tiempo estimado, redondeo, comisión, retorno y cargos excepcionales autorizados. Propuesta: precio fijo aceptado; sin cargo automático por cancelación o ausencia en el piloto. | Antes del loop 5 y antes de cobrar servicios reales. |
| DEC-07 | Paquetes | Pendientes peso y dimensiones máximas, contenido admitido, valor declarado y procedimiento ante daño o pérdida. Los límites serán obligatorios antes de habilitar encomiendas. | Antes del loop 8 y del piloto. |
| DEC-08 | Verificación y mapas | Pendientes proveedores, cobertura local, costo operativo y canal de acceso. Los códigos del servicio se comparten mediante el solicitante en la base del MVP. | Acceso antes del loop 2; mapas y ubicación básica en primer plano antes de cerrar el loop 3; segundo plano en loop 4. |
| DEC-09 | Soporte | Pendientes responsables, canal, horario y procedimiento ante incidentes durante el transporte. El horario de servicio debe corresponder a una operación realmente atendida. | Antes del piloto. |
| DEC-10 | Datos y evidencia | Pendientes plazos de conservación de ubicaciones, documentos y fotos, procedimiento de baja y acceso por rol. La evidencia propuesta fotografía el paquete, sin requerir rostros. | Antes de almacenar datos reales en el piloto. |
| DEC-11 | Operación comercial | Pendientes responsable del negocio y validación de requisitos locales aplicables, documentos del servicio y tratamiento de facturación. | Antes del piloto con terceros. |

Los siguientes valores son propuestas iniciales para pruebas, ajustables desde configuración y versionados cuando afecten una contratación:

| Parámetro | Valor inicial propuesto |
| --- | --- |
| Vigencia de cotización | 120 segundos. |
| Duración de cada oferta | 20 segundos, siempre dentro del plazo total de búsqueda. |
| Búsqueda total de conductor | 120 segundos; luego SIN_CONDUCTOR o continuación expresamente aceptada por el cliente mediante una nueva cotización si venció. |
| Antigüedad máxima de posición para recibir ofertas | 30 segundos. |
| Envío de ubicación durante operación | Objetivo de 5 segundos en movimiento y 20 segundos detenido, adaptado a restricciones del dispositivo; nunca prometer continuidad sin conexión. |
| Espera para reportar ausencia | 5 minutos desde llegada confirmada; la cancelación inmediata del cliente sigue disponible antes del inicio o recogida. |
| Verificación de códigos | 6 dígitos; máximo 5 intentos por hito antes de bloqueo y revisión; sin mostrar el código al conductor ni guardarlo en logs. |
| Proximidad para registrar llegada e hitos | Radio inicial de 150 metros con posición reciente; una excepción necesita operador, motivo y evidencia de ubicación. |

Una reasignación conserva el plazo inicial de búsqueda. Si lo agotó, el cliente debe aceptar continuar con una cotización vigente; el sistema no reinicia automáticamente esperas indefinidas. Una solicitud creada antes del vencimiento mantiene su precio durante la búsqueda autorizada aunque luego venza la cotización original. La aceptación del conductor dentro de esa búsqueda sigue siendo válida.

## Condiciones de salida

La especificación del loop 0 está preparada cuando alcance, roles, flujos, reglas y backlog son consistentes y las decisiones comerciales pendientes tienen un punto de resolución. Esta documentación permite comenzar la base técnica del loop 1.

Para habilitar el piloto se deben resolver DEC-03 a DEC-11, configurar sus valores y superar los criterios de MVP-33. Las decisiones pendientes no se sustituyen por valores monetarios o límites de paquete inventados. Todo cambio de alcance debe actualizar este documento, los estados afectados y las historias relacionadas.
