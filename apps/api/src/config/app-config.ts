import { Injectable } from '@nestjs/common';
import { Environment, loadEnvironment } from './environment';

@Injectable()
export class AppConfig {
  readonly values: Environment = loadEnvironment();
}
