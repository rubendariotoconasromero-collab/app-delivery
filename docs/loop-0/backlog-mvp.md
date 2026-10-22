# Backlog del MVP de pasajeros y encomiendas

Este backlog implementa el [alcance acordado](README.md) y los [flujos y estados](flujos-y-estados.md). P0 significa obligatorio para el lanzamiento del MVP; el piloto usa las funciones pertinentes ya cerradas de los loops 1 a 12. P1 corresponde a mejoras posteriores. Los loops indican la entrega inicial y su ampliación cuando proceda.

Cada criterio se verifica contra el backend real del ambiente de pruebas. Un criterio que depende de una decisión comercial utiliza su configuración versionada; la falta de ese valor impide habilitar la función para clientes reales.

## Base y acceso

### MVP 01 Base ejecutable

ID: MVP-01. P0. Loop 1. Dependencias: stack confirmado.

- Las dos apps Flutter y Angular consultan la API NestJS del ambiente de pruebas; cada entorno usa configuración y datos separados.
- Se aplican migraciones reproducibles con PostGIS y se comprueba conectividad con Redis; una caída de dependencia aparece en el diagnóstico del servicio.
- Se generan compilaciones de ambas apps para Android e iOS; contratos de API y eventos, validación de formato y pruebas pertinentes se ejecutan automáticamente.
- Se dispone de macOS y Xcode para las compilaciones iOS y se valida desde el inicio el acceso a dispositivos o al entorno de pruebas necesario.

### MVP 02 Identidad y acceso

ID: MVP-02. P0. Loop 2. Dependencias: MVP-01 y DEC-08.

- Cliente y conductor verifican su teléfono por el método elegido; código vencido o incorrecto no concede sesión y los intentos están limitados.
- El cierre de sesión y la recuperación invalidan las credenciales que corresponden; los códigos de acceso no sirven como códigos del servicio.
- Una cuenta bloqueada no crea ni acepta nuevos servicios. Si está atendiendo uno, se aplica el procedimiento de acceso limitado y resolución operativa.

### MVP 03 Perfil y contactos

ID: MVP-03. P0. Loop 2. Dependencias: MVP-02.

- El cliente mantiene nombre y teléfono de contacto; un cambio de teléfono requiere nueva verificación.
- El conductor y los contactos reciben únicamente la información necesaria para el servicio; el usuario consulta su propio historial.
- Una solicitud de baja revoca acceso según el procedimiento acordado y trata datos, evidencias y registros económicos conforme a DEC-10, sin borrar trazabilidad de forma indiscriminada.

### MVP 04 Acceso al panel y roles

ID: MVP-04. P0. Loop 2. Dependencias: MVP-02.

- Las cuentas del panel son individuales; los roles privilegiados requieren segundo factor y recuperación controlada.
- Un operador sin permiso financiero no ajusta cobros; finanzas no cambia estados de entrega; solo un administrador autorizado asigna roles.
- Acceder directamente a una API o evento reproduce la restricción de la interfaz. Un cambio de permisos revoca el acceso que ya no corresponde.

### MVP 05 Habilitación del conductor

ID: MVP-05. P0. Loop 2. Dependencias: MVP-02, MVP-04 y DEC-05.

- El conductor presenta perfil y documentos obligatorios con estado de revisión y vigencia.
- El administrador aprueba o rechaza con motivo; un documento sensible modificado o vencido bloquea nuevas asignaciones hasta revisión.
- Suspender un conductor ocupado abre gestión del servicio existente y conserva su historial y custodia.

### MVP 06 Vehículo y modalidades

ID: MVP-06. P0. Loop 2. Dependencias: MVP-05 y DEC-05.

- Se registran matrícula, categoría, capacidad y documentos; el administrador habilita modalidades compatibles.
- El conductor opera con un solo vehículo activo; no puede cambiarlo durante un servicio.
- Un vehículo suspendido, vencido o incompatible no aparece como candidato; la oferta informa la modalidad correcta.

## Contratación y ubicación

### MVP 07 Origen destino y cobertura

ID: MVP-07. P0. Loop 3 inicial y loop 5 completo. Dependencias: MVP-03, MVP-06, DEC-04 y DEC-08.

- El cliente busca o ajusta puntos en el mapa y añade referencias; denegar GPS permite introducirlos manualmente.
- Se guardan coordenadas y dirección para un origen y un destino dentro de la cobertura habilitada.
- Un punto fuera de cobertura, una ruta no calculable o una configuración incompleta impide contratar e informa cómo corregirlo.

### MVP 08 Cotización fija en bolivianos

ID: MVP-08. P0. Loop 3 simple y loop 5 completo. Dependencias: MVP-07 y DEC-06.

- El backend devuelve Bs, importe en centavos, conceptos, vencimiento, modalidad y versión de tarifa; enviar otro precio desde la app no lo modifica.
- Cambiar ruta, categoría o características del paquete invalida la cotización; vencida exige recotizar y aceptar antes de solicitar.
- El precio de un servicio asignado se conserva bajo sus condiciones aceptadas. Para encomiendas se informa también el costo o máximo de retorno y su condición de aplicación.
- Si el cliente crea la solicitud justo antes de vencer la cotización, el importe queda congelado durante su plazo de búsqueda: aceptar después del vencimiento original, pero dentro de ese plazo, sigue siendo válido. Una contratación nueva necesita cotización vigente.

### MVP 09 Crear y recuperar una solicitud

ID: MVP-09. P0. Loop 3. Dependencias: MVP-08.

- El cliente confirma modalidad, puntos, precio y condiciones y recibe un identificador de servicio en BUSCANDO.
- Repetir la misma confirmación tras un corte devuelve el mismo servicio; intentar otro servicio activo desde la misma cuenta se rechaza y permite abrir el vigente.
- El cliente recupera su solicitud al reabrir la app; el backend conserva la versión de condiciones aceptada.

### MVP 10 Disponibilidad del conductor

ID: MVP-10. P0. Loop 3 básico y loop 4 completo. Dependencias: MVP-05, MVP-06.

- Solo el conductor habilitado con vehículo vigente, ubicación reciente y conexión válida queda DISPONIBLE.
- Puede activar las modalidades aprobadas; no recibe ofertas de las demás ni nuevas ofertas estando ocupado o desconectado.
- Desconectarse, perder señal o vencer el GPS no elimina una asignación activa; la app permite recuperarla.

### MVP 11 GPS del conductor

ID: MVP-11. P0. Loop 3 en primer plano y loop 4 en segundo plano y continuidad. Dependencias: MVP-10.

- El loop 3 obtiene y recibe posición básica en primer plano para comprobar llegada e hitos del primer viaje; usa proveedor y cobertura de prueba configurados antes de esa entrega.
- En Android e iOS reales se registra posición durante la operación con pantalla bloqueada y cambios de red, según permisos y restricciones de cada dispositivo.
- Cada posición contiene tiempo de captura y precisión; el backend rechaza valores inválidos y posiciones anteriores a la última vigente.
- Cliente y operador ven antigüedad de ubicación. Una posición vencida no se usa para asignar; detener el seguimiento operativo fuera de disponibilidad y servicio respeta la configuración acordada.

### MVP 12 Eventos y seguimiento autorizado

ID: MVP-12. P0. Loop 4. Dependencias: MVP-09, MVP-11.

- Cliente ve el conductor asignado de su servicio; el conductor ve su asignación y el operador el ámbito permitido.
- Cambiar un ID o suscribirse a un canal ajeno se deniega sin revelar datos; al reasignar o cerrar se revoca seguimiento innecesario.
- Eventos duplicados o fuera de orden no revierten estados; una consulta al backend recupera el estado vigente.

## Asignación y pasajeros

### MVP 13 Búsqueda y ofertas

ID: MVP-13. P0. Loop 6. Dependencias: MVP-09, MVP-10, MVP-12.

- Los candidatos cumplen modalidad, zona, categoría, capacidad, vigencia documental, disponibilidad y antigüedad de posición.
- Cada oferta muestra modalidad, datos necesarios para decidir y remuneración prevista; tiene vencimiento calculado por servidor.
- Rechazar o vencer una oferta permite buscar otro candidato dentro del plazo total; modificar el reloj del móvil no amplía su validez.

### MVP 14 Aceptación exclusiva

ID: MVP-14. P0. Loop 3 manual y loop 6 automático. Dependencias: MVP-09; para automático también MVP-13.

- Dos conductores aceptando el mismo servicio obtienen exactamente una asignación vigente; el perdedor recibe el resultado actual.
- Un conductor aceptando simultáneamente pasajeros y encomiendas obtiene como máximo un servicio activo.
- La operación comprueba y reserva conductor y servicio en la misma transacción; repetir una aceptación confirmada devuelve el mismo resultado y retira las otras ofertas.

### MVP 15 Búsqueda agotada y reasignación

ID: MVP-15. P0. Loop 6. Dependencias: MVP-14.

- Vencida la búsqueda sin aceptación válida, el cliente ve SIN_CONDUCTOR y puede iniciar una nueva contratación.
- Antes de inicio o recogida, desistir o reasignar anula la reserva, las ofertas y códigos anteriores, manteniendo historial y plazo de búsqueda.
- Superado ese plazo se solicita una continuación expresa con cotización vigente; después de inicio o recogida se tramita incidencia sin reasignación automática.
- Si una encomienda recibió efectivo antes de autorizar recogida, solo vuelve a BUSCANDO después de un reembolso ejecutado y documentado. Si no se consigue, pasa a CANCELADO con obligación de reembolso; no se asigna a otro conductor para cobrar de nuevo el mismo servicio.
- RECOGIDA_AUTORIZADA bloquea cancelación y reasignación ordinarias y no vence liberando reservas; cualquier discrepancia de entrega física requiere intervención operativa.

### MVP 16 Llegada e inicio de pasajeros

ID: MVP-16. P0. Loop 3 inicial y loop 7 completo. Dependencias: MVP-14 y ubicación básica de MVP-11.

- El conductor asignado confirma llegada con posición reciente y proximidad válida; el servidor registra la hora y avisa al cliente.
- Solo un código válido del pasajero cambia EN_ORIGEN a EN_CURSO y registra ubicación y hora de inicio.
- Código incorrecto, consumido, servicio ajeno o inicio fuera de orden se rechaza; superar el máximo de intentos bloquea el hito y requiere revisión.

### MVP 17 Finalizar el viaje

ID: MVP-17. P0. Loop 3 inicial y loop 7 completo. Dependencias: MVP-16.

- Solo el conductor asignado de un viaje EN_CURSO finaliza en destino con proximidad válida o excepción operativa registrada.
- Se conserva importe contratado, destino real y horarios; repetir el cierre no duplica efectos y libera una sola vez la reserva.
- El cliente obtiene comprobante e historial. Un cobro pendiente o disputado se conserva separado del viaje FINALIZADO.

### MVP 18 Cancelación ausencia e interrupción

ID: MVP-18. P0. Loop 7. Dependencias: MVP-15, MVP-16, MVP-17 y DEC-06.

- Antes de iniciar, el cliente cancela y el sistema retira ofertas y reservas; se informa el efecto económico antes de confirmar. La base propuesta no aplica cargo automático por cancelación o ausencia.
- El conductor reporta ausencia solo tras llegada válida y espera mínima del servidor; nunca inicia con ese motivo.
- Después de iniciar, el operador coordina cierre físico e INTERRUMPIDO, terminal operativo que libera las reservas de cliente y conductor una sola vez; el importe queda en revisión y cualquier ajuste requiere permiso financiero y motivo.

## Encomiendas

### MVP 19 Solicitar una encomienda compatible

ID: MVP-19. P0. Loop 8. Dependencias: MVP-07 a MVP-09, MVP-14 y DEC-07.

- Se registran descripción, características requeridas, remitente, destinatario y teléfonos, sin exigir cuenta al destinatario.
- Exceso de límites, contenido no admitido o falta de capacidad impide solicitar. No se cobra el valor comercial del contenido.
- El cliente acepta precio base, responsable del pago y condiciones de retorno; una diferencia detectada en origen se gestiona antes de recoger y exige nueva aceptación si afecta la contratación.

### MVP 20 Recogida e inicio de custodia

ID: MVP-20. P0. Loop 8. Dependencias: MVP-19, MVP-12 y registro básico de MVP-23.

- El conductor asignado registra llegada, condición exterior y evidencia; código válido y condición de cobro cumplida habilitan RECOGIDA_AUTORIZADA antes de la entrega material. Autorización y cancelación concurrentes tienen un único ganador.
- Después de la autorización el remitente entrega el paquete y el conductor confirma recepción para pasar a EN_TRASLADO con responsable, hora y lugar. Si no llega respuesta, la app muestra pendiente y conserva reserva; el operador reconcilia cualquier discrepancia de custodia material.
- Desde RECOGIDA_AUTORIZADA no hay cancelación ni reasignación ordinarias. Sin entrega física, un operador puede resolver la autorización con evidencia; con custodia efectiva, cancelar implica retorno o incidencia y conserva la reserva.

### MVP 21 Entrega verificada

ID: MVP-21. P0. Loop 8. Dependencias: MVP-20.

- El conductor registra llegada al destino con posición reciente y proximidad válida; el servidor guarda la hora para medir espera. Verifica código de entrega distinto al de recogida, registra recepción material y evidencia y el servidor confirma ENTREGADO; un cierre pendiente conserva reserva.
- Entregar antes de recoger, usar código de otro hito o repetir confirmación no produce un cierre adicional.
- El destinatario no paga por recibir; el solicitante obtiene resultado y comprobante. Una excepción al código requiere operador autorizado, motivo y evidencia alternativa.

### MVP 22 Entrega fallida devolución y resolución

ID: MVP-22. P0. Loop 8. Dependencias: MVP-20, MVP-21.

- Ausencia requiere llegada verificable a destino, espera mínima del servidor e intentos de contacto. Rechazo o imposibilidad de acceso requieren evidencia específica y revisión operativa. ENTREGA_FALLIDA conserva conductor y custodia y no genera por sí sola el cargo de retorno.
- Operador autoriza retorno al origen según condiciones aceptadas; conductor pasa a EN_DEVOLUCION y confirma DEVUELTO con nuevo código y evidencia.
- Si tampoco se recibe el retorno, mantiene incidencia y responsable. Solo administrador autorizado registra una resolución excepcional efectiva, con destino conocido o pérdida declarada, último responsable y tratamiento económico; no lo marca entregado.

## Efectivo y administración

### MVP 23 Declaración del efectivo

ID: MVP-23. P0. Loop 3 para pasajeros, loop 8 para recogida y loop 9 completo. Dependencias: MVP-08; ampliación según MVP-17, MVP-20 y MVP-22.

- El conductor declara total recibido, parcial o impago, con importe en centavos y servicio relacionado; la app informa que registra una declaración de efectivo.
- Repetir la misma declaración no duplica cobros. El cliente puede reportar diferencia y se conserva lo declarado por cada actor.
- Se aplica cobro al final del viaje y en recogida de encomienda. Un retorno se registra aparte según condiciones aceptadas; una cancelación después de recibir efectivo conserva el reembolso pendiente.
- Un conductor que cobró y desiste antes de recoger no permite recobro automático por un reemplazo: se exige reembolso documentado para reasignar o se cancela con obligación pendiente. Se conserva quién recibió y quién devolvió cada importe.

### MVP 24 Movimientos comisiones y conciliación

ID: MVP-24. P0. Loop 9. Dependencias: MVP-23, MVP-04 y DEC-06.

- El panel distingue precio, efectivo declarado, comisión y saldo a remitir o compensar; todos los importes usan BOB y centavos enteros.
- Finanzas registra remesas, diferencias, reembolsos realmente ejecutados y ajustes con motivo y evidencia; no sobrescribe movimientos originales.
- Se concilian por separado cobro al cliente y remesa del conductor. Un caso de ejemplo con pago parcial, comisión, retorno y reembolso cuadra con sus movimientos y saldos.

### MVP 25 Panel operativo y asignación manual

ID: MVP-25. P0. Loop 3 inicial y loop 10 completo. Dependencias: MVP-04, MVP-09, MVP-14.

- Operador busca por servicio, cliente, conductor, modalidad, estado y fecha, y consulta cronología y última ubicación autorizada.
- Una asignación manual respeta habilitación, reserva, capacidad, modalidad y estado; una carrera contra aceptación automática conserva un solo ganador.
- Reasignar o resolver una excepción exige motivo; no se permite transferir un paquete recogido como si fuera una nueva oferta.

### MVP 26 Configuración de tarifas y cobertura

ID: MVP-26. P0. Loop 5 inicial y loop 10 completo. Dependencias: MVP-04, DEC-04 y DEC-06.

- Solo un administrador autorizado publica una versión de cobertura, horarios y tarifas con fecha de vigencia.
- La nueva versión afecta nuevas cotizaciones; no reescribe importes ni condiciones de servicios ya aceptados.
- Se rechazan parámetros incompletos o incompatibles; la ausencia de moneda, cobertura, límites aplicables o precio bloquea la modalidad afectada.

### MVP 27 Soporte e incidencias

ID: MVP-27. P0. Loops 7, 8 y 10. Dependencias: MVP-25 y DEC-09.

- Cliente y conductor pueden abrir incidencia relacionada con su servicio y ver el canal y horario real de atención.
- Operador registra responsable, motivo, acciones y resultado; distingue reclamo de efectivo, interrupción de pasajeros y custodia de paquete.
- La acción de asistencia facilita contacto según el procedimiento definido, sin presentar una respuesta garantizada que la operación no pueda prestar; toda resolución excepcional conserva auditoría.

### MVP 28 Notificaciones de operación

ID: MVP-28. P0. Loops 6 a 8. Dependencias: MVP-12, MVP-13 y proveedor de notificaciones seleccionado.

- Oferta, asignación, llegada, resultado e incidencia relevante generan avisos para los participantes autorizados.
- Una notificación tardía abre el estado consultado al servidor; una oferta vencida no se puede aceptar.
- Denegar notificaciones se comunica sin alterar el servicio; el conductor solo queda disponible si cumple el canal operativo definido para recibir ofertas.

### MVP 29 Seguridad evidencia y auditoría

ID: MVP-29. P0. Desde loop 2; consolidación loop 12. Dependencias: MVP-04 y DEC-10.

- Se prueban accesos por rol y pertenencia en API, archivos y eventos; documentos y fotos no quedan disponibles mediante enlaces públicos permanentes.
- Se limitan intentos de acceso y códigos, se validan cargas y se excluyen credenciales y códigos de los logs.
- Cada cambio sensible registra actor, hora, recurso y motivo. Retención y baja siguen la política configurada; la información no necesaria deja de exponerse tras el servicio.

### MVP 30 Trabajos y eventos recuperables

ID: MVP-30. P0. Loop 11. Dependencias: MVP-14, MVP-22, MVP-24, MVP-28.

- Una transición confirmada conserva un evento pendiente de publicación aunque caiga el trabajador; al recuperarse entrega el evento sin duplicar efectos de negocio.
- Expiración, reintento y notificación repetidos respetan versión y estado vigente; un trabajo atrasado no cancela un servicio ya asignado o iniciado.
- Vaciar la caché de presencia no borra asignaciones, custodia, importes ni historial; se reconstruye disponibilidad sin permitir dobles reservas.

### MVP 31 Recuperación ante desconexión

ID: MVP-31. P0. Loop 4 inicial y loop 11 completo. Dependencias: MVP-09, MVP-12.

- Al cerrar y reabrir cualquiera de las apps se consulta y muestra el servicio activo desde el backend.
- Perder conexión durante aceptación, recogida, entrega o cobro produce un resultado recuperable; reintentar con el mismo identificador no duplica el efecto.
- Acciones pendientes no aparecen confirmadas; posiciones almacenadas se ordenan por captura y no desplazan una ubicación actual con otra antigua.

### MVP 32 Indicadores e historial administrativo

ID: MVP-32. P0. Loop 10. Dependencias: MVP-24, MVP-25.

- Panel filtra viajes y envíos por período, estado y conductor; usa hora local America/La_Paz y distingue servicios de cobros.
- Se muestran solicitudes, asignaciones, finalizados o entregados, cancelaciones, sin conductor, retornos, efectivo declarado y diferencias.
- Los totales concuerdan con los registros de origen y los permisos se mantienen al exportar; los datos privados no necesarios se excluyen.

## Validación y lanzamiento

### MVP 33 Criterios del piloto

ID: MVP-33. P0. Loops 12 y 13. Dependencias: MVP-01 a MVP-32 y DEC-03 a DEC-11 resueltas para operar.

- Se ejecutan recorridos completos de ambas modalidades, cancelación, ausencia, entrega fallida, retorno, cobro parcial, disputa, reasignación y cierre excepcional; no quedan defectos que dupliquen servicios, pierdan custodia o alteren movimientos.
- Se ensayan dos aceptaciones simultáneas, aceptación manual contra automática, cortes de red y reinicios; cada caso conserva reservas y resultado correcto.
- Se ensayan efectivo previo a reasignación, autorización de recogida contra cancelación, corte entre autorización y entrega física, ausencia sin llegada y cierre INTERRUMPIDO; se comprueban responsables, reservas y movimientos resultantes.
- Se restauran base y evidencia desde un respaldo y se verifica consistencia; se observan errores, demoras y trabajos pendientes desde herramientas operativas.
- Propuesta de prueba de capacidad: 100 conductores y 200 clientes conectados, hasta 20 posiciones por segundo; p95 menor o igual a 1 segundo para API propia sin proveedores externos y 5 segundos desde recepción de posición hasta visualización, en red estable. Se ajusta el perfil si cambia la capacidad del lanzamiento.
- Propuesta de piloto acompañado: al menos 10 viajes, 10 envíos y 3 devoluciones, con Android e iOS representados en cliente y conductor; cada defecto crítico se corrige y el escenario afectado se repite. Estas cantidades son aceptación operativa inicial, no una demostración estadística de fiabilidad.

### MVP 34 Operación y publicación

ID: MVP-34. P0. Loop 14. Dependencias: MVP-33.

- Ambas apps tienen compilaciones firmadas, identidades separadas y configuración de producción; se preparan los requisitos de publicación y los avisos de datos y permisos aplicables.
- La operación dispone de responsables, atención, conciliación, monitoreo, respaldos y procedimiento de recuperación y despliegue reversible comprobado.
- El lanzamiento comienza con cobertura y participantes controlados; una versión nueva del backend conserva compatibilidad con las versiones móviles admitidas y existe un procedimiento para exigir actualización cuando sea necesario.

## Mejoras posteriores

| ID | P1 | Condición para priorizar |
| --- | --- | --- |
| POST-01 | Pagos digitales | Proveedor y conciliación adecuados al mercado; extender el registro monetario sin cambiar estados de custodia. |
| POST-02 | Reservas | Demanda de contratación anticipada y reglas de disponibilidad y cancelación. |
| POST-03 | Varias paradas | Modelo de etapas y aceptación de cambios de importe. |
| POST-04 | Encomiendas interurbanas | Operación por tramos, nodos y transferencias verificadas de custodia. |
| POST-05 | Entregas agrupadas | Capacidad, secuenciación y trazabilidad por paquete. |
| POST-06 | Varias ciudades y categorías | Cobertura y operación estables por mercado. |
| POST-07 | Calificaciones y favoritos | Flujos principales validados y mecanismos de revisión definidos. |
| POST-08 | Seguimiento compartido por enlace | Acceso revocable, vencimiento y datos mínimos. |
| POST-09 | Promociones y referidos | Medición de adquisición y tratamiento de descuentos y abuso. |
| POST-10 | Navegación integrada | Justificación operativa y evaluación del proveedor local. |

## Orden de implementación

La primera ruta de entrega es MVP-01 → MVP-02 a MVP-06 → MVP-07 a MVP-09 → MVP-14 manual → MVP-16 y MVP-17 básicos → MVP-23 básico → MVP-25 básico. Produce un viaje completo supervisado en pruebas durante el loop 3.

El loop 3 incluye ubicación básica en primer plano y cobertura y tarifa de prueba; se selecciona proveedor de mapas antes de cerrarlo. Después se integran segundo plano, continuidad y eventos en el loop 4, cotización completa en el 5, asignación automática en el 6 y excepciones de pasajeros en el 7. Encomiendas en el loop 8 reutiliza esa base e incluye declaración de efectivo en recogida; el loop 9 completa movimientos y conciliación. Los loops 10 a 14 consolidan operación, recuperación y lanzamiento.

Las dependencias de esta lista son funcionales; las pruebas, permisos y auditoría pertinentes acompañan cada historia desde su primera entrega. Cada cierre deja demostración, evidencia de los criterios comprobados y registro de decisiones pendientes.
