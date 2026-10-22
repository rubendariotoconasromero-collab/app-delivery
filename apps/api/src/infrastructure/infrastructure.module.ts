import { Module } from '@nestjs/common';
import { DependencyProbe } from './dependency-probe';

@Module({ providers: [DependencyProbe], exports: [DependencyProbe] })
export class InfrastructureModule {}
