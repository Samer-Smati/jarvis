import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Skill, SkillContext, SkillResult } from '../skill.interface';

@Injectable()
export class EmailSkill implements Skill {
  readonly name = 'send_email';
  readonly description =
    'Draft and send an email on the user\'s behalf via configured SMTP (Gmail app password, Outlook, etc.).';
  readonly requiresConfirmation = true;
  readonly parameters = {
    type: 'object',
    properties: {
      to: { type: 'string' },
      subject: { type: 'string' },
      body: { type: 'string' },
    },
    required: ['to', 'subject', 'body'],
  };

  constructor(private readonly config: ConfigService) {}

  async execute(args: Record<string, unknown>, _context: SkillContext): Promise<SkillResult> {
    const to = asString(args.to);
    const subject = asString(args.subject);
    const body = asString(args.body);
    if (!to || !subject || !body) {
      return { success: false, output: 'Fields "to", "subject", and "body" are required.' };
    }

    if (!this.isConfigured()) {
      return {
        success: false,
        output:
          'Email is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, and SMTP_PASS in backend/.env. ' +
          'Here is a draft the user can copy:\n\n' +
          `To: ${to}\nSubject: ${subject}\n\n${body}`,
      };
    }

    try {
      const transport = nodemailer.createTransport({
        host: this.config.get<string>('SMTP_HOST'),
        port: Number(this.config.get<string>('SMTP_PORT') ?? 587),
        secure: this.config.get<string>('SMTP_SECURE') === 'true',
        auth: {
          user: this.config.get<string>('SMTP_USER'),
          pass: this.config.get<string>('SMTP_PASS'),
        },
      });
      const from = this.config.get<string>('SMTP_FROM') ?? this.config.get<string>('SMTP_USER');
      await transport.sendMail({ from, to, subject, text: body });
      return { success: true, output: `Email sent to ${to}.` };
    } catch (error) {
      return { success: false, output: `Email failed: ${(error as Error).message}` };
    }
  }

  private isConfigured(): boolean {
    return !!(
      this.config.get<string>('SMTP_HOST')?.trim() &&
      this.config.get<string>('SMTP_USER')?.trim() &&
      this.config.get<string>('SMTP_PASS')?.trim()
    );
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
