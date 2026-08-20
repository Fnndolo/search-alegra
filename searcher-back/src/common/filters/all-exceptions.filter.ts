import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';

interface ResolvedError {
  status: number;
  message: string;
  error: string;
}

/**
 * Nest's default handler only knows how to unwrap HttpException — anything else (a TypeORM
 * QueryFailedError, a raw axios error that slipped past a service's own try/catch) gets flattened
 * to a bare "Internal server error" with no detail, even though the real cause is known and often
 * user-actionable (duplicate IMEI, invalid Alegra payload, etc.). This filter decodes those cases
 * too, so the frontend's `error.error.message` toast always has something real to show.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const resolved = this.resolve(exception);

    if (resolved.status >= 500) {
      this.logger.error(
        `${request.method} ${request.originalUrl} -> ${resolved.status}: ${resolved.message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(resolved.status).json({
      statusCode: resolved.status,
      message: resolved.message,
      error: resolved.error,
      timestamp: new Date().toISOString(),
      path: request.originalUrl,
    });
  }

  private resolve(exception: unknown): ResolvedError {
    if (exception instanceof HttpException) {
      return this.resolveHttpException(exception);
    }
    if (exception instanceof QueryFailedError) {
      return this.resolveDbError(exception);
    }
    const anyErr = exception as any;
    if (anyErr?.isAxiosError) {
      return this.resolveAxiosError(anyErr);
    }

    const message = exception instanceof Error ? exception.message : 'Error interno del servidor';
    return { status: HttpStatus.INTERNAL_SERVER_ERROR, message, error: 'InternalServerError' };
  }

  private resolveHttpException(exception: HttpException): ResolvedError {
    const status = exception.getStatus();
    const body = exception.getResponse();

    // Nest passes non-HttpException-shaped values straight through as the response body (e.g. a
    // BadRequestException constructed with an object). Normalize every shape into a plain string.
    let message: unknown;
    if (typeof body === 'string') {
      message = body;
    } else {
      const b = body as Record<string, any>;
      message = b?.message ?? b?.es ?? b?.en ?? exception.message;
    }
    if (Array.isArray(message)) message = message.join(', ');

    const error = (body as any)?.error ?? exception.name;
    return { status, message: String(message), error };
  }

  private resolveAxiosError(err: any): ResolvedError {
    const alegraBody = err.response?.data;
    const alegraMessage = alegraBody?.message ?? alegraBody?.es ?? alegraBody?.en;
    return {
      status: err.response?.status ?? HttpStatus.BAD_GATEWAY,
      message: alegraMessage ?? err.message ?? 'Error al comunicarse con Alegra',
      error: 'AlegraApiError',
    };
  }

  private resolveDbError(exception: QueryFailedError): ResolvedError {
    // Postgres error codes: https://www.postgresql.org/docs/current/errcodes-appendix.html
    const driverError = (exception as any).driverError ?? {};
    const code = driverError.code;

    switch (code) {
      case '23505': // unique_violation
        return {
          status: HttpStatus.CONFLICT,
          message: this.describeUniqueViolation(driverError),
          error: 'UniqueConstraintViolation',
        };
      case '23503': // foreign_key_violation
        return {
          status: HttpStatus.BAD_REQUEST,
          message: 'La operación hace referencia a un registro que no existe',
          error: 'ForeignKeyViolation',
        };
      case '23502': // not_null_violation
        return {
          status: HttpStatus.BAD_REQUEST,
          message: driverError.column
            ? `El campo "${driverError.column}" es requerido`
            : 'Falta un campo requerido',
          error: 'NotNullViolation',
        };
      case '22P02': // invalid_text_representation (bad UUID/int cast)
        return {
          status: HttpStatus.BAD_REQUEST,
          message: 'Uno de los valores enviados tiene un formato inválido',
          error: 'InvalidInputSyntax',
        };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Error al acceder a la base de datos',
          error: 'DatabaseError',
        };
    }
  }

  private describeUniqueViolation(driverError: any): string {
    const detail: string | undefined = driverError.detail;
    // Postgres detail looks like: Key (identifier)=(123456789012345) already exists.
    const match = detail?.match(/Key \(([^)]+)\)=\(([^)]+)\)/);
    if (match) {
      const [, field, value] = match;
      return `Ya existe un registro con ${field} = "${value}"`;
    }
    return 'Ya existe un registro con ese valor';
  }
}
