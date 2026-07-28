import { Injectable } from '@nestjs/common';

import { Skill, SkillResult } from '../skill.interface';



@Injectable()

export class MediaSkill implements Skill {

  readonly name = 'media_control';

  readonly description = 'Play, pause, or queue music and media.';

  readonly requiresConfirmation = false;

  readonly parameters = {

    type: 'object',

    properties: {

      command: { type: 'string', enum: ['play', 'pause', 'next', 'queue'] },

      query: { type: 'string' },

    },

    required: ['command'],

  };



  async execute(): Promise<SkillResult> {

    return {

      success: false,

      output:
        'Media control is not configured yet. Set up Spotify/Apple Music integration in settings, or disable this skill.',

    };

  }

}

