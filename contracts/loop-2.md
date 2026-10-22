# Contratos de identidad y habilitación del loop 2

Base `/api/v1`. Decisión confirmada: OTP por teléfono en modo de desarrollo, sin proveedor SMS. Este modo no puede habilitarse en producción. El backend valida todas las entradas y devuelve errores Nest con `statusCode`, `message` y `error`; los clientes presentan el mensaje y no simulan éxito si falla la persistencia.

## Identidad

Roles: `client`, `driver`, `operator`, `finance`, `admin`. Estado de cuenta: `active` o `suspended`. Usuario público: `{id,displayName,phone,email,roles,status}`; phone/email pueden ser null para cuentas del personal o móviles respectivamente. Solo `client` y `driver` pueden solicitarse durante un registro público, y quedan ligados al desafío verificado. Un teléfono puede tener ambas modalidades; no se crean dos identidades para el mismo número.

| Método y ruta | Solicitud | Respuesta |
| --- | --- | --- |
| POST `/auth/otp/request` | `{phone,purpose:'register'|'login'|'recover',role:'client'|'driver',displayName?}`; displayName obligatorio al registrar. Teléfono E.164, interfaz propone +591. | 202 `{challengeId,expiresIn,retryAfter,developmentCode?}`. Código solo en modo desarrollo explícito. |
| POST `/auth/otp/verify` | `{challengeId,code}` | 200 `{accessToken,expiresAt,user}`. Token móvil opaco y aleatorio. |
| GET `/auth/me` | Bearer móvil o cookie del panel. | `{user,expiresAt,csrfToken?}`. |
| POST `/auth/logout` | Sesión vigente; CSRF si se usa cookie. | 204, revoca la sesión y limpia cookie cuando corresponda. |
| POST `/auth/admin/login` | `{email,password,totp}` | `{user,expiresAt,csrfToken}` y cookie HttpOnly del panel. |
| GET `/admin/users?limit=50&offset=0` | Rol admin y sesión del panel con MFA; limit 1–100. | `{items:User[],total,limit,offset}`. |
| PATCH `/admin/users/:id` | `{roles?,status?}`; solo admin. | Usuario actualizado; permisos efectivos se verifican en cada petición. |

Panel: cookie HttpOnly, SameSite y Secure en producción; token CSRF para mutaciones autenticadas mediante cookie. El token móvil no habilita rutas del personal aunque una cuenta tenga roles adicionales. Flutter guarda el token en almacenamiento seguro del sistema y nunca en dart-defines. El panel no guarda credenciales en localStorage.

El administrador inicial se crea con una herramienta local explícita y TOTP real; no existen contraseñas o usuarios administradores predeterminados en el código. La recuperación por teléfono revoca sesiones móviles anteriores; los cambios de roles y suspensión tienen efecto inmediato.

## Modelos de habilitación

`ReviewStatus`: `draft`, `pending`, `approved`, `rejected`, `suspended`.

`Driver`: `{id,displayName,fullName,phone,reviewStatus,reviewReason,submittedAt,reviewedAt,activeVehicleId,eligible}`. El ID coincide con el del usuario. `fullName` es el nombre revisado del conductor; cambiar el alias de cliente no reemplaza ese dato.

`Vehicle`: `{id,driverId,plate,make,model,year,capacityPassengers,serviceTypes,reviewStatus,reviewReason,submittedAt,reviewedAt,active}`. Modalidades: `passengers`, `parcels`.

`Document`: `{id,kind,originalName,mimeType,size,expiresOn,createdAt,vehicleId}`. No expone rutas de disco. Tipos de desarrollo: `identity_document`, `driver_license`, `vehicle_registration`. Los dos primeros corresponden al conductor y el último al vehículo. Los requisitos operativos y vigencias finales siguen sujetos a la validación comercial del loop 0.

La licencia y el documento del vehículo requieren vencimiento futuro; el documento de identidad admite vencimiento opcional. La edición de datos revisados o documentos invalida la aprobación afectada y la selección activa. La elegibilidad exige cuenta activa, conductor y vehículo aprobados, documentos vigentes y vehículo seleccionado.

## API de conductor y revisión

Todas las rutas `/drivers/me` pertenecen al conductor autenticado; los IDs ajenos se rechazan. Revisar requiere rol admin y sesión del panel con MFA. La asignación y otras operaciones de servicio pertenecen a los loops siguientes.

| Método y ruta | Solicitud | Respuesta |
| --- | --- | --- |
| GET `/drivers/me` | — | `{driver,vehicles,documents}`. Perfil vacío en draft hasta guardarlo. |
| PUT `/drivers/me` | `{fullName}` | `{driver,vehicles,documents}`. |
| POST `/drivers/me/documents` | Multipart `kind`, `expiresOn?`, `file`. | Document. PDF/JPEG/PNG, máximo 5 MiB. |
| POST `/drivers/me/submit` | `{}` | `{driver,vehicles,documents}`; requiere datos y documentos válidos. |
| POST `/drivers/me/vehicles` | `{plate,make,model,year,capacityPassengers,serviceTypes}` | Vehicle. |
| PUT `/drivers/me/vehicles/:id` | Mismos campos. | Vehicle, nueva revisión si cambia datos sensibles. |
| POST `/drivers/me/vehicles/:id/documents` | Multipart `kind:'vehicle_registration'`, `expiresOn`, `file`. | Document. |
| POST `/drivers/me/vehicles/:id/submit` | `{}` | Vehicle en pending si cumple requisitos. |
| POST `/drivers/me/vehicles/:id/activate` | `{}` | `{driver,vehicles,documents}`; máximo un vehículo activo. |
| GET `/documents/:id` | Propietario o admin con sesión de panel. | Archivo privado; cabeceras sin caché compartida. |
| GET `/admin/drivers?status=...&limit=50&offset=0` | Filtro opcional; limit 1–100. | `{items:Driver[],total,limit,offset}`. |
| GET `/admin/drivers/:id` | — | `{driver,vehicles,documents,audit}`. |
| POST `/admin/drivers/:id/review` | `{decision:'approve'|'reject'|'suspend',reason}` | `{driver,vehicles,documents,audit}`. |
| POST `/admin/vehicles/:id/review` | Misma forma. | `{driver,vehicles,documents,audit}`. |

`audit`: entradas `{id,actorId,action,reason,createdAt,targetType,targetId}`. Aprobar exige estado pending y documentación vigente; no basta con cambiar una etiqueta. Un documento sustituto conserva el historial y deja de ser el documento vigente del mismo tipo.

## Contrato interno del backend

Migración de identidad `0002_identity.sql`: tablas `app_users` y `app_user_roles`; el resto de tablas de sesiones, OTP y MFA lo administra el módulo auth. `app_users`: `id UUID`, `phone`, `email`, `display_name`, `status`, marcas de tiempo. Roles en `app_user_roles(user_id,role)`.

El módulo auth exporta `AuthModule`, `@CurrentUser()` y `@Roles(...roles)` desde `src/auth`; el usuario autenticado añade `sessionId` y `sessionKind:'mobile'|'admin'` a los campos del usuario público. La autenticación protege rutas por defecto, con un decorador explícito para rutas públicas de acceso, info y health. `@Roles` acepta cualquiera de los roles indicados; las rutas solo de personal exigen además sessionKind admin y MFA verificado. El módulo driver comprueba pertenencia para cada documento o vehículo.

Migración de habilitación `0003_driver_onboarding.sql`: perfiles, vehículos, documentos privados y auditoría, con claves foráneas a identidad. Los archivos se guardan fuera de directorios públicos. No se crean tablas ficticias de viajes ni se afirma resolver servicios activos antes de implementarlos en el loop 3.
