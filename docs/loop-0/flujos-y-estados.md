# Flujos y estados de pasajeros y encomiendas

Esta especificación usa el [alcance del MVP](README.md): Santa Cruz de la Sierra, importes en bolivianos, efectivo y un único servicio activo por conductor y cliente. Los valores configurables propuestos se encuentran en el documento de alcance.

## Estados independientes

El servicio, las ofertas, la disponibilidad del conductor y el dinero tienen estados separados. Finalizar un viaje no acredita que el efectivo haya sido recibido, y perder la conexión no cancela el servicio.

| Elemento | Estados funcionales |
| --- | --- |
| Oferta a conductor | PENDIENTE, ACEPTADA, RECHAZADA, VENCIDA, RETIRADA. |
| Disponibilidad | DESCONECTADO, DISPONIBLE, OCUPADO. La vigencia del GPS y la habilitación se verifican aparte. |
| Cobro | PENDIENTE, DECLARADO_COBRADO, PARCIAL, IMPAGO, EN_DISPUTA. |
| Conciliación | PENDIENTE, CONCILIADO, CON_DIFERENCIA. |
| Incidencia | ABIERTA, EN_GESTION, RESUELTA. Abrir una incidencia no cambia por sí solo el estado del servicio. |

Los reembolsos, cargos adicionales aceptados y ajustes se registran como movimientos relacionados, sin sobrescribir los movimientos originales. DECLARADO_COBRADO registra una declaración del conductor; el panel distingue esa declaración de una conciliación realizada por finanzas.

Son terminales operativos FINALIZADO, INTERRUMPIDO, CANCELADO y SIN_CONDUCTOR para pasajeros; ENTREGADO, DEVUELTO, CANCELADO, SIN_CONDUCTOR y RESUELTO_POR_INCIDENCIA para encomiendas. Al confirmar un terminal válido se liberan atómicamente las reservas de cliente y conductor, si existían, una sola vez. Pueden permanecer abiertos cobros, conciliaciones e incidencias económicas. Un estado con custodia o recogida autorizada pendiente nunca es terminal por vencimiento automático.

## Alta y habilitación de conductor

1. El conductor crea una cuenta y presenta perfil, documentos y vehículo.
2. El administrador revisa, aprueba o rechaza con motivo. Las modificaciones sensibles vuelven a revisión.
3. El conductor aprobado selecciona un vehículo habilitado y las modalidades autorizadas.
4. La app valida permisos, ubicación y conectividad; el backend confirma su disponibilidad.
5. Solo recibe ofertas compatibles con categoría, capacidad, zona, modalidad y posición vigente.

Una suspensión o vencimiento bloquea nuevas asignaciones. Si existe un servicio activo, el operador resuelve cómo concluirlo; el acceso mínimo necesario para atenderlo se gestiona explícitamente y no se elimina la custodia de una encomienda.

## Flujo común de contratación y asignación

1. El cliente elige pasajeros o encomiendas y registra origen, destino y referencias. Puede introducir direcciones manualmente si deniega su ubicación.
2. El backend valida cobertura y recorrido. Para encomiendas verifica también características del paquete y compatibilidad de vehículo.
3. El backend cotiza en BOB e informa precio, conceptos, condiciones y vencimiento. El retorno de una encomienda tiene una condición y un importe o máximo informado y aceptado desde esta instancia.
4. El cliente confirma la cotización vigente. La solicitud lleva una clave que permite reconocer un reintento y se crea en BUSCANDO, congelando importe y condiciones para su plazo de búsqueda. El vencimiento posterior de la cotización no invalida esa búsqueda ni una aceptación dentro de su plazo.
5. Se seleccionan candidatos cercanos, se evalúa su llegada estimada y se emiten ofertas. La oferta informa modalidad, puntos necesarios para decidir y remuneración prevista; el contacto completo se habilita después de asignar.
6. El primer conductor cuya aceptación confirme el servidor obtiene el servicio. La misma transacción verifica solicitud, oferta, disponibilidad y reserva del conductor; las demás ofertas se retiran.
7. Cliente, conductor y panel reciben el resultado. Cada app puede volver a consultar el estado vigente si no recibe el evento.
8. Rechazar o ignorar una oferta permite continuar buscando. Al vencer el plazo total sin conductor, la solicitud termina en SIN_CONDUCTOR.

La asignación manual ejecuta las mismas validaciones. La hora del servidor determina vencimientos; modificar el reloj del teléfono no extiende cotizaciones ni ofertas.

## Transporte de pasajeros

Recorrido principal: BUSCANDO → ASIGNADO → EN_ORIGEN → EN_CURSO → FINALIZADO.

| Transición | Actor y precondición | Resultado observable |
| --- | --- | --- |
| BUSCANDO a ASIGNADO | Aceptación válida del conductor o asignación manual autorizada. | Conductor reservado; cliente ve conductor, vehículo y llegada estimada. |
| ASIGNADO a EN_ORIGEN | Conductor asignado registra llegada con ubicación reciente y proximidad válida, o excepción auditada del operador. | Se notifica llegada y comienza la espera del servidor. |
| EN_ORIGEN a EN_CURSO | Conductor ingresa código válido del pasajero. | Se consume el código, se registra inicio y se mantiene al conductor ocupado. |
| EN_CURSO a FINALIZADO | Conductor confirma llegada al destino dentro de las condiciones de proximidad, o excepción operativa autorizada. | Se registran fin, ubicación e importe del servicio; se libera reserva y se tramita cobro por separado. |
| BUSCANDO, ASIGNADO o EN_ORIGEN a CANCELADO | Cliente cancela; operador actúa con motivo; ausencia habilitada tras espera. | Se retiran ofertas, se libera reserva y se conserva motivo. En la propuesta del piloto no se genera cargo automático. |
| ASIGNADO o EN_ORIGEN a BUSCANDO | Conductor desiste antes del inicio, o reasignación autorizada. | Se invalida la asignación anterior y su código; la búsqueda continúa dentro de su presupuesto temporal. |
| BUSCANDO a SIN_CONDUCTOR | Vence búsqueda sin asignación válida. | Cliente ve resultado; una nueva búsqueda requiere su acción y cotización vigente. |
| EN_CURSO a INTERRUMPIDO | Operador registra terminación anticipada después de coordinar el cierre físico del traslado. | Terminal operativo: se conserva destino real y motivo y se liberan ambas reservas atómicamente; el importe queda en revisión independiente. No se aplica cancelación ordinaria. |

El conductor no inicia sin código ni altera el precio desde su app. No se permite cambiar el destino contratado durante el recorrido en el MVP; una necesidad de cambio se atiende como incidencia. Para un cierre anticipado, el operador deja una propuesta de importe y finanzas registra cualquier ajuste o reembolso con motivo y comunicación al cliente.

## Encomiendas y custodia

Recorrido principal: BUSCANDO → ASIGNADO → EN_ORIGEN → RECOGIDA_AUTORIZADA → EN_TRASLADO → ENTREGADO.

1. El cliente registra remitente, destinatario, teléfonos, descripción y características del paquete. Acepta límites, precio base y condiciones de retorno.
2. El conductor llega al origen e inspecciona las características declaradas antes de aceptar custodia. Si no son compatibles, reporta incidencia y no recoge el paquete.
3. El remitente paga el transporte en efectivo. El conductor registra la declaración de cobro; una excepción de pago requiere autorización operativa explícita.
4. El conductor valida el código de recogida y registra la evidencia y condición exterior del paquete. El backend confirma RECOGIDA_AUTORIZADA antes de la entrega material y bloquea cancelación y reasignación ordinarias. Cliente y conductor ven la autorización.
5. El remitente entrega físicamente el paquete y el conductor confirma recepción. El backend registra EN_TRASLADO y la custodia material. Si se corta la conexión entre autorización y recepción, la reserva se conserva; al recuperar conexión se confirma la situación real o se abre intervención operativa.
6. En destino el conductor registra llegada con ubicación reciente. Para ausencia debe esperar el plazo definido e informar intentos de contacto; rechazo o imposibilidad de acceso requieren su evidencia propia.
7. Verifica un código distinto antes de entregar y registra recepción material y evidencia para solicitar el cierre. Solo después el backend confirma ENTREGADO; el cliente recibe resultado y comprobante. Si el cierre queda pendiente por falta de red, se conserva la reserva hasta sincronizar o resolver por operador. No se cobra al destinatario.

| Transición | Actor y precondición | Resultado observable |
| --- | --- | --- |
| BUSCANDO a ASIGNADO | Aceptación válida o asignación manual autorizada. | Conductor reservado para el envío. |
| ASIGNADO a EN_ORIGEN | Conductor confirma llegada con posición reciente y proximidad válida. | Se inicia espera; el remitente prepara paquete, pago y código. |
| EN_ORIGEN a RECOGIDA_AUTORIZADA | Conductor asignado; código de recogida, evidencia y condición de cobro válidos. | Se autoriza entrega material; la autorización gana o pierde atómicamente frente a una cancelación concurrente. Se conservan reservas. |
| RECOGIDA_AUTORIZADA a EN_TRASLADO | Conductor confirma recepción física del paquete con hora y evidencia. | Se registra quién tomó custodia, cuándo y dónde. |
| EN_TRASLADO a ENTREGADO | Llegada al destino registrada, código de entrega distinto al de recogida, recepción material, evidencia y proximidad válida, o alternativa controlada del operador. | Se registra recepción y finaliza custodia; se liberan ambas reservas. |
| BUSCANDO, ASIGNADO o EN_ORIGEN a CANCELADO | Cliente u operador cancela antes de autorizar entrega material. | Se liberan reservas. Si ya se declaró efectivo recibido, queda un movimiento de reembolso pendiente de ejecutar y conciliar. |
| ASIGNADO o EN_ORIGEN a BUSCANDO | Desistimiento o reasignación antes de autorizar recogida, sin efectivo retenido del servicio. | Se anula asignación y códigos anteriores. Si hubo efectivo, requiere reembolso ejecutado y documentado; si no se logra, se cancela con reembolso pendiente y no se vuelve a cobrar ese servicio. |
| RECOGIDA_AUTORIZADA a CANCELADO | Solo operador, tras verificar y documentar que el paquete no fue entregado materialmente. | Se resuelve autorización pendiente, se liberan reservas y se conserva cualquier obligación de reembolso. Si hubo entrega material, se confirma custodia y se gestiona retorno o incidencia. |
| BUSCANDO a SIN_CONDUCTOR | Vence búsqueda. | Cliente ve resultado sin cobro por transporte no prestado. |
| EN_TRASLADO a ENTREGA_FALLIDA | Para ausencia: llegada al destino válida, espera del servidor e intentos de contacto. Para rechazo, acceso imposible u otra causa: evidencia y revisión operativa según motivo. | Se conserva conductor y custodia; se informa al cliente y al operador. No se genera cargo de retorno solo por declarar el fallo. |
| ENTREGA_FALLIDA o EN_TRASLADO a DEVOLUCION_AUTORIZADA | Operador confirma retorno, motivo y condiciones aceptadas; incluye solicitud de cancelar tras recoger. | El conductor sigue ocupado y conoce el origen de retorno. |
| DEVOLUCION_AUTORIZADA a EN_DEVOLUCION | Conductor confirma inicio del retorno. | Continúa la custodia y seguimiento. |
| EN_DEVOLUCION a DEVUELTO | Confirmación del remitente mediante nuevo código de devolución y evidencia, o excepción autorizada. | Se registra devolución efectiva, importe de retorno aplicable y liberación del conductor. |
| Después de recoger a RESUELTO_POR_INCIDENCIA | Administrador registra resolución excepcional de pérdida, daño u otro caso que impide entrega o devolución normal. | Se conserva último responsable, hechos, destino conocido del paquete, evidencia y tratamiento económico; nunca se muestra como entregado. |

Si el remitente tampoco recibe la devolución, se conserva EN_DEVOLUCION con incidencia abierta y conductor responsable. No hay depósitos ni transferencia automática a otro conductor en el MVP. El cierre excepcional requiere una resolución efectiva y documentada, no un cambio de estado para liberar capacidad.

RECOGIDA_AUTORIZADA no expira liberando al conductor: puede existir entrega material aún no sincronizada. Si hubo una entrega física fuera del protocolo y una cancelación ganó antes de la autorización, debe abrirse incidencia de custodia y reservar al responsable mientras se reconstruyen los hechos. El sistema no convierte esa discrepancia en una entrega o devolución ficticia.

Los códigos son diferentes por recogida, entrega y devolución, están asociados al servicio y al hito, tienen intentos limitados y se consumen una vez. Los anteriores se invalidan al reasignar antes de recoger. La base del MVP permite al solicitante comunicarlos a cada contacto; esto acredita conocimiento del código, no identificación personal del receptor.

## Efectivo y conciliación

1. La contratación guarda tarifa, moneda BOB, importe base, comisión y condiciones aceptadas. Las cantidades se almacenan en centavos enteros.
2. El pasajero paga al concluir el viaje. La encomienda se paga en origen; un eventual retorno aceptado se cobra al remitente al devolver o se registra como pendiente si no fue pagado.
3. El conductor declara importe recibido, impago o diferencia. Una repetición de la misma acción no genera un movimiento adicional.
4. El cliente puede reportar una discrepancia. La declaración pasa a revisión sin cambiar el hecho de que el transporte terminó o la custodia se resolvió.
5. Finanzas revisa servicios, cobros declarados, comisión y saldo. Como el conductor recibe el efectivo, se calcula lo que debe remitir a la operación o lo que esta deba compensarle.
6. Una remesa de comisión, reembolso o ajuste registra monto, fecha, responsable, motivo y evidencia. Se concilian por separado el cobro al cliente y la remesa a la operación.
7. Si un conductor recibió efectivo antes de recoger y luego desiste, no se envía otro conductor mientras ese efectivo siga retenido en el mismo servicio. Reasignar exige reembolso efectuado y documentado; si no es posible, se cancela con reembolso pendiente e incidencia. Una nueva contratación es una acción expresa del cliente, con aviso del saldo pendiente, no un recobro automático.

Antes de iniciar o recoger, cambiar datos que afectan el precio exige una cotización nueva y aceptación del cliente. El conductor no impone sobrecargos; el retorno solo genera el cargo previamente aceptado cuando corresponde y queda registrado. Un cobro disputado o pendiente no impide registrar una entrega material verdadera.

## Conectividad y ubicación

- Nuevas aceptaciones, códigos, inicio, autorización de recogida, recepción y cierres requieren confirmación del backend. La entrega física del paquete espera la autorización; una recepción pendiente conserva reservas. Si no hay red, la app distingue pendiente, rechazado y confirmado.
- Una operación pendiente se reenvía con el mismo identificador; al reabrir la app se recupera el servicio activo y su versión desde el servidor.
- Las posiciones incluyen instante de captura, precisión y secuencia. El backend descarta las atrasadas para presencia actual; una posición almacenada durante una desconexión no reaparece como ubicación reciente.
- La app muestra cuándo fue la última actualización. Si la posición caduca, el conductor queda excluido de nuevas ofertas, pero conserva su servicio activo.
- Los eventos se autorizan por cuenta, asignación y rol. Al finalizar o reasignar se retira el acceso al seguimiento que ya no corresponde.
- Una notificación tardía abre el estado real consultado al servidor; no reactiva una oferta ni revive un servicio finalizado.
- Elegir desconectarse deja de aceptar nuevas ofertas. No abandona ni borra un servicio ya aceptado.

## Invariantes de aceptación

| Regla | Escenario que debe pasar |
| --- | --- |
| Un conductor no atiende dos servicios activos. | Acepta a la vez un viaje y un envío: solo uno se confirma. |
| Un servicio no tiene dos asignaciones vigentes. | Dos conductores aceptan la misma oferta lógica: hay un único ganador y el otro recibe estado actualizado. |
| El cliente no duplica solicitudes por cortes de red. | Repite una confirmación con el mismo identificador: recibe el mismo servicio. |
| La encomienda conserva responsable. | Falla la entrega tras recoger: el conductor continúa reservado hasta devolución o resolución efectiva. |
| La entrega material se coordina con la reserva. | Se pierde red tras autorizar recogida: no se cancela ni reasigna automáticamente y se reconcilia quién tiene el paquete. |
| La reasignación no duplica el efectivo. | Se recibió dinero antes de recoger: solo se reasigna después de documentar reembolso; de otro modo se cancela con obligación de devolver. |
| La ausencia exige un intento verificable. | Se intenta declarar destinatario ausente sin llegada ni espera: el servidor rechaza y conserva custodia. |
| La reserva y el efectivo son independientes. | Se entrega el paquete con una diferencia de cobro: queda entregado y la diferencia sigue abierta. |
| Los hitos son ordenados. | Se intenta entregar antes de recoger, iniciar antes de llegada o usar un código consumido: el backend rechaza sin efectos adicionales. |
| El actor tiene permiso. | Cambia el ID de servicio o se suscribe a un canal ajeno: recibe denegación sin datos del servicio. |
| La suspensión no deja un servicio sin atención. | Se suspende un conductor ocupado: se bloquean nuevas ofertas y se abre gestión del servicio existente. |
